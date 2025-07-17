<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { mainCategories } from "../../products/utils/categoryData";
    import {
        X,
        Check,
        X as XIcon,
        AlertCircle,
        Database,
        RefreshCw,
    } from "lucide-svelte";
    import { clickable } from "../../shared/actions/clickable";
    import { uploadService } from "../../services/DHTUploadService";

    // No longer need DataManager context - using direct imports

    export let onClose = () => {};

    let reports: any[] = [];
    let loading: boolean = true;
    let error: string | null = null;
    let selectedReport: any = null;
    let showApproveDialog: boolean = false;

    let approvingAll: boolean = false;
    let approvedCount: number = 0;
    let totalToApprove: number = 0;

    // Category selection variables (for system-detected failures)
    let selectedCategory: string | null = null;
    let selectedSubcategory: string | null = null;
    let selectedProductType: string | null = null;
    let subcategories: any[] = [];
    let productTypes: any[] = [];

    // Recategorization variables
    let queueingForRecategorization: boolean = false;
    let processingQueue: boolean = false;

    // Sync DHT variables
    let syncStatusModalOpen: boolean = false;

    onMount(async () => {
        await loadReports();
    });

    async function loadReports(preserveScroll: boolean = false): Promise<void> {
        try {
            // Save scroll position if preserving
            const scrollPosition = preserveScroll
                ? document.querySelector(".table-container")?.scrollTop
                : 0;

            loading = true;
            error = null; // Clear previous errors
            const response = await fetch(
                "http://localhost:3000/api/category-reports",
            );
            if (response.ok) {
                reports = await response.json();
            } else {
                error = "Failed to load reports";
                console.error("Failed to load reports:", await response.text());
            }

            // Restore scroll position if needed
            if (preserveScroll && scrollPosition) {
                setTimeout(() => {
                    const container =
                        document.querySelector(".table-container");
                    if (container) container.scrollTop = scrollPosition;
                }, 10);
            }
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : "Unknown error occurred";
            error = errorMessage;
            console.error("Error in loadReports:", err);
        } finally {
            loading = false;
        }
    }

    function viewReport(report: any): void {
        // Make a full copy to ensure reactivity
        selectedReport = JSON.parse(JSON.stringify(report));
        error = null; // Clear error when opening new dialog

        // Force reactivity with a setTimeout
        setTimeout(() => {
            showApproveDialog = true;
            console.log(
                "Dialog should be visible now, showApproveDialog =",
                showApproveDialog,
            );
        }, 0);

        if (report.type === "negative_example") {
            selectedCategory = null;
            selectedSubcategory = null;
            selectedProductType = null;
        } else if (report.source === "system" || !report.suggestedCategory) {
            selectedCategory = report.currentCategory.category;
            selectedSubcategory = null; // Keep null, user must select for system reports
            selectedProductType = null;
        } else {
            selectedCategory = report.suggestedCategory.category;
            selectedSubcategory = report.suggestedCategory.subcategory;
            selectedProductType = report.suggestedCategory.product_type;
        }
    }

    // Reactive statements for category selection
    $: {
        if (selectedCategory) {
            const categoryData = mainCategories.find(
                (c: any) => c.name === selectedCategory,
            );
            subcategories = categoryData?.subcategories || [];
            if (
                selectedSubcategory &&
                !subcategories.find((s: any) => s.name === selectedSubcategory)
            ) {
                selectedSubcategory = null;
                selectedProductType = null;
            }
        } else {
            subcategories = [];
            selectedSubcategory = null;
            selectedProductType = null;
        }
    }

    $: {
        if (selectedSubcategory) {
            const subcategoryData = subcategories.find(
                (s: any) => s.name === selectedSubcategory,
            );
            productTypes = subcategoryData?.productTypes || [];
            if (subcategoryData?.gridOnly) {
                selectedProductType = selectedSubcategory; // Auto-set for gridOnly
            } else if (
                selectedProductType &&
                !productTypes.includes(selectedProductType)
            ) {
                selectedProductType = null;
            }
        } else {
            productTypes = [];
            selectedProductType = null;
        }
    }

    async function approveReport(reportId: any = null): Promise<void> {
        const reportToApprove = reportId
            ? reports.find((r: any) => r.id === reportId)
            : selectedReport;

        if (!reportToApprove || reportToApprove.id === undefined) {
            error = "No report selected or report ID is missing.";
            console.error(
                "approveReport error: report is invalid",
                reportToApprove,
            );
            return;
        }

        const reportIdForProcessing = reportToApprove.id; // Capture the ID safely
        error = null; // Clear previous errors

        try {
            console.log("Approving report with ID:", reportIdForProcessing);

            const needsUserSelection =
                reportToApprove.source === "system" ||
                !reportToApprove.suggestedCategory;
            const isNegativeExample =
                reportToApprove.type === "negative_example";

            // For quick approval directly from table, we don't modify categories
            let categoryToUpdateWith = reportToApprove.suggestedCategory;

            if (!isNegativeExample && needsUserSelection && showApproveDialog) {
                // Only do the full category selection if we're in the dialog
                if (!selectedCategory || !selectedSubcategory) {
                    error =
                        "Please select at least a category and subcategory.";
                    return;
                }
                const isGridOnly = subcategories.find(
                    (s: any) => s.name === selectedSubcategory,
                )?.gridOnly;
                categoryToUpdateWith = {
                    category: selectedCategory,
                    subcategory: selectedSubcategory,
                    product_type: isGridOnly
                        ? selectedSubcategory
                        : selectedProductType,
                };

                console.log(
                    "Updating report category before approval:",
                    categoryToUpdateWith,
                );
                const updateResponse = await fetch(
                    "http://localhost:3000/api/update-report-category",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            reportId: reportIdForProcessing,
                            suggestedCategory: categoryToUpdateWith,
                        }),
                    },
                );
                if (!updateResponse.ok) {
                    const updateErrorText = await updateResponse.text();
                    error = `Failed to update report category: ${updateErrorText}`;
                    console.error(
                        "Failed to update report category:",
                        updateErrorText,
                    );
                    return;
                }
                // Update local report if it matches the selected one
                if (
                    selectedReport &&
                    selectedReport.id === reportIdForProcessing
                ) {
                    selectedReport.suggestedCategory = categoryToUpdateWith;
                }

                // Also update the reports array
                const reportIndex = reports.findIndex(
                    (r: any) => r.id === reportIdForProcessing,
                );
                if (reportIndex !== -1) {
                    reports[reportIndex].suggestedCategory =
                        categoryToUpdateWith;
                    reports = [...reports]; // Trigger reactivity
                }
            } else if (
                isNegativeExample &&
                !reportToApprove.suggestedCategory
            ) {
                // For negative examples without admin selection, ensure a placeholder suggestedCategory exists
                categoryToUpdateWith = {
                    category: reportToApprove.currentCategory.category,
                    subcategory: reportToApprove.currentCategory.subcategory,
                    product_type: reportToApprove.currentCategory.product_type,
                };
                // Optionally update the report file with this placeholder
                await fetch(
                    "http://localhost:3000/api/update-report-category",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            reportId: reportIdForProcessing,
                            suggestedCategory: categoryToUpdateWith,
                        }),
                    },
                );
                // Update local report if it matches the selected one
                if (
                    selectedReport &&
                    selectedReport.id === reportIdForProcessing
                ) {
                    selectedReport.suggestedCategory = categoryToUpdateWith;
                }

                // Also update the reports array
                const reportIndex = reports.findIndex(
                    (r: any) => r.id === reportIdForProcessing,
                );
                if (reportIndex !== -1) {
                    reports[reportIndex].suggestedCategory =
                        categoryToUpdateWith;
                    reports = [...reports]; // Trigger reactivity
                }
            }

            // Now approve the report (updates status and correction map on backend)
            const approveResponse = await fetch(
                "http://localhost:3000/api/approve-category-report",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        reportId: reportIdForProcessing,
                        approve: true,
                    }),
                },
            );

            if (!approveResponse.ok) {
                const approveErrorText = await approveResponse.text();
                error = `Failed to approve report: ${approveErrorText}`;
                console.error("Failed to approve report:", approveErrorText);
                return;
            }

            // Report is approved on backend, now queue it for recategorization
            const queuedSuccessfully = await queueForRecategorization(
                reportIdForProcessing,
                false,
            );

            if (queuedSuccessfully) {
                if (showApproveDialog) {
                    showApproveDialog = false;
                    selectedReport = null; // Clear selection
                }

                // Update local state
                const reportIndex = reports.findIndex(
                    (r: any) => r.id === reportIdForProcessing,
                );
                if (reportIndex !== -1) {
                    reports[reportIndex].status = "approved";
                    reports = [...reports]; // Trigger reactivity
                }

                // Load reports in the background without disrupting UI
                setTimeout(() => {
                    loadReports(true);
                }, 100);
            } else {
                // Error message should have been set by queueForRecategorization
                // Keep dialog open for user to see the error.
                // The report is 'approved' on the backend, but not yet 'queued'.
                // User might need to retry queuing or admin intervention.
                console.log(
                    "Report approved, but failed to queue. Dialog remains open.",
                );
                // Force a reload to show 'approved' status from server if queueing failed.
                setTimeout(() => {
                    loadReports(true);
                }, 100);
            }
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : "Unknown error occurred";
            error = errorMessage;
            console.error("Error in approveReport:", err);
        }
    }

    async function queueForRecategorization(
        reportIdToQueue: any, // Expecting the actual ID (e.g., array index or unique DB ID)
        showMessages: boolean = true,
    ): Promise<boolean> {
        if (reportIdToQueue === null || reportIdToQueue === undefined) {
            const errMessage =
                "Cannot queue report: Invalid report ID provided.";
            console.error(
                "queueForRecategorization error:",
                errMessage,
                "reportIdToQueue was:",
                reportIdToQueue,
            );
            if (showMessages) error = errMessage;
            return false; // Indicate failure
        }

        if (showMessages) queueingForRecategorization = true;
        error = null; // Clear previous errors if showing messages

        try {
            console.log(
                "Queueing report for recategorization, ID:",
                reportIdToQueue,
            );
            const response = await fetch(
                "http://localhost:3000/api/queue-for-recategorization",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reportId: reportIdToQueue }),
                },
            );

            const result = await response.json();

            if (response.ok) {
                // Update UI for the specific report to "queued_for_recategorization"
                const index = reports.findIndex(
                    (r: any) => r.id === reportIdToQueue,
                );
                if (index !== -1) {
                    reports[index].status = "queued_for_recategorization";
                    if (!reports[index].queued_at)
                        reports[index].queued_at = new Date().toISOString(); // Add if not present
                    reports = [...reports]; // Trigger Svelte reactivity
                } else {
                    // This case means the local 'reports' array is out of sync or ID is wrong
                    console.warn(
                        `queueForRecategorization: Report ID ${reportIdToQueue} not found in local 'reports' array for UI status update. A full reload might be needed.`,
                    );
                }

                if (showMessages) {
                    error = "Product queued for recategorization successfully.";
                    // If called standalone with showMessages=true, and it's from the dialog context:
                    if (
                        selectedReport &&
                        selectedReport.id === reportIdToQueue
                    ) {
                        showApproveDialog = false;
                        selectedReport = null;
                        await loadReports(); // Reload if standalone queueing from dialog
                    }
                }
                return true; // Indicate success
            } else {
                const errMessage = `Failed to queue for recategorization: ${result.error || "Unknown error"}`;
                console.error(errMessage, "(ID:", reportIdToQueue, ")");
                if (showMessages) error = errMessage;
                return false; // Indicate failure
            }
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : "Unknown error occurred";
            const errMessage = `Error in queueForRecategorization: ${errorMessage}`;
            console.error(errMessage, "(ID:", reportIdToQueue, ")", err);
            if (showMessages) error = errMessage;
            return false; // Indicate failure
        } finally {
            if (showMessages) queueingForRecategorization = false;
        }
    }

    // Process recategorization queue
    async function processRecategorizationQueue(): Promise<void> {
        try {
            processingQueue = true;
            error = "Processing recategorization queue...";

            const response = await fetch(
                "http://localhost:3000/api/process-recategorization-queue",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                },
            );

            const result = await response.json();

            if (response.ok) {
                error = `Successfully processed ${result.processed} products from recategorization queue`;
                await loadReports();
            } else {
                error = `Failed to process recategorization queue: ${result.error || "Unknown error"}`;
            }
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : "Unknown error occurred";
            console.error("Error processing recategorization queue:", err);
            error = errorMessage;
        } finally {
            processingQueue = false;
        }
    }

    async function approveAllReports(): Promise<void> {
        approvingAll = true;
        error = null;
        const pendingReports = reports.filter(
            (r: any) =>
                (!r.status || r.status === "pending") &&
                r.suggestedCategory && // Only those with suggestions
                r.source !== "system", // Exclude system reports for bulk approve
        );

        if (pendingReports.length === 0) {
            error = "No user-suggested reports available for bulk approval.";
            approvingAll = false;
            return;
        }

        totalToApprove = pendingReports.length;
        approvedCount = 0;
        let bulkErrorOccurred = false;

        for (const report of pendingReports) {
            if (report.id === undefined) {
                console.error(
                    "Bulk approve: Skipping report with undefined ID",
                    report,
                );
                totalToApprove--; // Adjust total since we're skipping
                continue;
            }
            error = `Approving ${approvedCount + 1} of ${totalToApprove} reports...`;
            try {
                const approveResponse = await fetch(
                    "http://localhost:3000/api/approve-category-report",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            reportId: report.id,
                            approve: true,
                        }),
                    },
                );

                if (approveResponse.ok) {
                    // Attempt to queue immediately after successful approval
                    const queuedSuccessfully = await queueForRecategorization(
                        report.id,
                        false,
                    );
                    if (queuedSuccessfully) {
                        approvedCount++;
                    } else {
                        console.warn(
                            `Bulk approve: Report ${report.id} approved but failed to queue.`,
                        );
                        bulkErrorOccurred = true;
                        // The report status in UI will be 'approved' but not 'queued'.
                        // loadReports() at the end will refresh this.
                    }
                } else {
                    console.error(
                        `Bulk approve: Error approving report ${report.id}:`,
                        await approveResponse.text(),
                    );
                    bulkErrorOccurred = true;
                }
            } catch (err: unknown) {
                console.error(
                    `Bulk approve: Exception for report ${report.id}:`,
                    err,
                );
                bulkErrorOccurred = true;
            }
        }

        if (bulkErrorOccurred) {
            error = `Bulk approval: ${approvedCount}/${totalToApprove} reports successfully approved and queued. Some errors occurred.`;
        } else if (approvedCount > 0) {
            error = `Successfully approved and queued ${approvedCount} of ${totalToApprove} reports.`;
        } else {
            error = "Bulk approval: No reports were processed successfully.";
        }

        await loadReports(); // Refresh list to show all status updates
        approvingAll = false;
    }

    async function rejectReport(reportId: any = null): Promise<void> {
        const reportToReject = reportId
            ? reports.find((r: any) => r.id === reportId)
            : selectedReport;

        if (!reportToReject || reportToReject.id === undefined) {
            error = "No report selected or report ID is missing for rejection.";
            console.error(
                "rejectReport error: report is invalid",
                reportToReject,
            );
            return;
        }
        const reportIdToReject = reportToReject.id;
        error = null;

        try {
            const response = await fetch(
                "http://localhost:3000/api/approve-category-report",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        reportId: reportIdToReject,
                        approve: false, // false means reject
                    }),
                },
            );

            if (response.ok) {
                // Update the local reports array immediately
                const reportIndex = reports.findIndex(
                    (r: any) => r.id === reportIdToReject,
                );
                if (reportIndex !== -1) {
                    reports[reportIndex].status = "rejected";
                    reports = [...reports]; // Trigger reactivity
                }

                if (showApproveDialog) {
                    showApproveDialog = false;
                    selectedReport = null;
                }

                // Load reports in the background without disrupting UI
                setTimeout(() => {
                    loadReports(true);
                }, 100);
            } else {
                error = `Failed to reject report: ${await response.text()}`;
                console.error(
                    "Failed to reject report:",
                    await response.text(),
                );
            }
        } catch (err: unknown) {
            const errorMessage =
                err instanceof Error ? err.message : "Unknown error occurred";
            error = errorMessage;
            console.error("Error in rejectReport:", err);
        }
    }

    function getStatusBadgeClass(status: any): string {
        if (status === "approved") return "badge-success";
        if (status === "rejected") return "badge-danger";
        if (status === "queued_for_recategorization") return "badge-info";
        if (status === "recategorized") return "badge-warning";
        return "badge-pending";
    }

    function getSourceBadgeClass(source: any): string {
        return source === "system" ? "badge-system" : "badge-user";
    }

    function getReportTypeBadgeClass(type: any): string {
        if (type === "negative_example") return "badge-negative";
        if (type === "suggestion") return "badge-suggestion";
        return "badge-default";
    }

    function portal(node: HTMLElement) {
        const target = document.body;

        // We need to ensure we only append once and track it properly
        let appended = false;

        function update() {
            if (!appended) {
                target.appendChild(node);
                appended = true;
            }
        }

        function destroy() {
            if (appended && node.parentNode) {
                node.parentNode.removeChild(node);
                appended = false;
            }
        }

        update();

        return {
            update,
            destroy,
        };
    }

    // Control body overflow
    $: if (showApproveDialog) {
        document.body.style.overflow = "hidden"; // Disable scrolling when dialog open
    } else {
        document.body.style.overflow = ""; // Re-enable scrolling when closed
    }

    onDestroy(() => {
        // Ensure scrolling is re-enabled if component is destroyed while dialog is open
        document.body.style.overflow = "";
    });

    // Function to trigger DHT synchronization (MOVED FROM SIDEBAR)
    async function syncDht(): Promise<void> {
        syncStatusModalOpen = true;

        try {
            if (uploadService) {
                // Note: syncDht method removed - using simple upload now
                await uploadService.loadFromSavedData();
            }
        } catch (error) {
            console.error("Error during DHT sync:", error);
        }
    }

    // Get sync status from the store (MOVED FROM SIDEBAR)
    $: syncStatus = {
        inProgress: false,
        message: "",
        progress: 0,
        totalToUpdate: 0,
        completedUpdates: 0,
    };

    // Close modal when sync completes (MOVED FROM SIDEBAR)
    $: if (
        syncStatusModalOpen &&
        !syncStatus.inProgress &&
        syncStatus.message &&
        syncStatus.message.includes("completed")
    ) {
        setTimeout(() => {
            syncStatusModalOpen = false;
        }, 3000);
    }
</script>

<div class="admin-container">
    <div class="admin-header">
        <h1>Category Reports Admin</h1>
        <button class="close-btn" on:click={onClose}>✕</button>
    </div>

    <!-- NEW DATA ADMIN SECTION - Added from SidebarMenu.svelte -->
    <div class="data-admin-actions">
        <h2 class="data-admin-title">Data Controls</h2>
        <div class="data-admin-buttons">
            <button
                class="data-admin-btn"
                on:click={() => uploadService?.loadFromSavedData()}
            >
                <span class="btn-icon">
                    <Database size={18} />
                </span>
                Load Saved Data
            </button>

            <button class="data-admin-btn" on:click={syncDht}>
                <span class="btn-icon">
                    <RefreshCw size={18} />
                </span>
                Sync DHT
            </button>
        </div>
    </div>

    <div class="admin-actions">
        <div class="action-group">
            <button
                class="approve-all-btn"
                on:click={approveAllReports}
                disabled={approvingAll || loading}
            >
                {approvingAll
                    ? `Approving ${approvedCount}/${totalToApprove}...`
                    : "Approve All User Suggestions"}
            </button>
            <p class="hint">
                Approve pending reports with user-suggested categories
            </p>
        </div>

        <div class="action-group">
            <button
                class="process-queue-btn"
                on:click={processRecategorizationQueue}
                disabled={processingQueue || loading}
            >
                {processingQueue
                    ? "Processing queue..."
                    : "Process Recategorization Queue"}
            </button>
            <p class="hint">
                Recategorize products that have been queued for processing
            </p>
        </div>
    </div>

    {#if error}
        <div class="error-message">
            {error}
        </div>
    {/if}

    {#if loading}
        <div class="loading">Loading reports...</div>
    {:else if reports.length === 0}
        <div class="no-data">No category reports found.</div>
    {:else}
        <div class="table-container">
            <table class="reports-table">
                <thead>
                    <tr>
                        <th>Image</th>
                        <th>Product</th>
                        <th>Current Category</th>
                        <th>Suggested Category</th>
                        <th>Status</th>
                        <th>Source</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {#each reports as report, i (report.id)}
                        <tr
                            class={report.source === "system"
                                ? "system-row"
                                : ""}
                        >
                            <td class="image-cell">
                                {#if report.product.image_url}
                                    <img
                                        src={report.product.image_url}
                                        alt={report.product.name}
                                        class="product-thumbnail"
                                    />
                                {:else}
                                    <div class="no-image-placeholder">
                                        No image
                                    </div>
                                {/if}
                            </td>
                            <td>{report.product.name}</td>
                            <td>
                                {report.currentCategory.category || "N/A"} →
                                {report.currentCategory.subcategory || "N/A"} →
                                {report.currentCategory.product_type || "N/A"}
                            </td>
                            <td>
                                {#if report.type === "negative_example"}
                                    <span class="negative-example"
                                        >Incorrect Category Report</span
                                    >
                                {:else if report.suggestedCategory && report.suggestedCategory.category}
                                    {report.suggestedCategory.category} →
                                    {report.suggestedCategory.subcategory ||
                                        "N/A"} →
                                    {report.suggestedCategory.product_type ||
                                        report.suggestedCategory.subcategory ||
                                        "N/A"}
                                {:else}
                                    <span class="needs-review"
                                        >Needs Admin Review</span
                                    >
                                {/if}
                            </td>
                            <td>
                                <span
                                    class="badge {getStatusBadgeClass(
                                        report.status,
                                    )}"
                                >
                                    {report.status || "pending"}
                                </span>
                            </td>
                            <td>
                                <span
                                    class="badge {getSourceBadgeClass(
                                        report.source,
                                    )}"
                                >
                                    {report.source || "user"}
                                </span>
                            </td>
                            <td class="actions-cell">
                                {#if !report.status || report.status === "pending"}
                                    <div class="action-buttons">
                                        {#if report.source !== "system" && report.suggestedCategory && report.suggestedCategory.category}
                                            <button
                                                class="approve-quick-btn"
                                                on:click={() =>
                                                    approveReport(report.id)}
                                                title="Approve"
                                            >
                                                <Check size={16} />
                                            </button>
                                            <button
                                                class="reject-quick-btn"
                                                on:click={() =>
                                                    rejectReport(report.id)}
                                                title="Reject"
                                            >
                                                <XIcon size={16} />
                                            </button>
                                        {/if}
                                        <button
                                            class="view-btn"
                                            on:click={() => viewReport(report)}
                                            title="Review Details"
                                        >
                                            {report.source === "system" ||
                                            !report.suggestedCategory
                                                ? "Review"
                                                : "Details"}
                                        </button>
                                    </div>
                                {:else}
                                    <button
                                        class="view-btn"
                                        on:click={() => viewReport(report)}
                                        disabled={report.status ===
                                            "recategorized" ||
                                            report.status === "rejected"}
                                    >
                                        View
                                    </button>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>

{#if showApproveDialog && selectedReport}
    <div
        class="overlay"
        style="background-color: rgba(0,0,0,0.7); z-index: 9999;"
        use:clickable={() => {
            showApproveDialog = false;
            selectedReport = null;
        }}
        use:portal
    >
        <div
            class="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialogTitle"
        >
            <h2 id="dialogTitle">
                Review Category Report ({selectedReport.id})
            </h2>

            <div class="report-details">
                <div class="report-section">
                    <h3>Product</h3>
                    <p><strong>Name:</strong> {selectedReport.product.name}</p>
                    <p>
                        <strong>Size:</strong>
                        {selectedReport.product.size || "Not specified"}
                    </p>
                    {#if selectedReport.product.image_url}
                        <img
                            src={selectedReport.product.image_url}
                            alt={selectedReport.product.name}
                            class="product-img"
                        />
                    {:else}
                        <div class="no-image">
                            <p>No image available for this product</p>
                            <p class="product-name">
                                {selectedReport.product.name}
                            </p>
                        </div>
                    {/if}
                </div>

                <div class="report-section">
                    <h3>Current Categorization</h3>
                    <ul>
                        <li>
                            <strong>Category:</strong>
                            {selectedReport.currentCategory.category || "N/A"}
                        </li>
                        <li>
                            <strong>Subcategory:</strong>
                            {selectedReport.currentCategory.subcategory ||
                                "N/A"}
                        </li>
                        <li>
                            <strong>Product Type:</strong>
                            {selectedReport.currentCategory.product_type ||
                                "N/A"}
                        </li>
                    </ul>
                </div>

                {#if selectedReport.source === "system" || !selectedReport.suggestedCategory?.category || selectedReport.type === "negative_example"}
                    <div class="report-section system-section">
                        <h3>
                            {#if selectedReport.type === "negative_example"}
                                Flagged as Incorrect
                            {:else}
                                Select Correct Category
                            {/if}
                        </h3>
                        {#if selectedReport.type !== "negative_example"}
                            <p class="system-note">
                                This report requires you to select the correct
                                category.
                            </p>
                        {/if}

                        <div class="form-group">
                            <label for="category">Category:</label>
                            <select
                                id="category"
                                bind:value={selectedCategory}
                                class="form-select"
                                disabled={selectedReport.type ===
                                    "negative_example"}
                            >
                                <option value={null}>Select Category</option>
                                {#each mainCategories as category}
                                    <option value={category.name}
                                        >{category.name}</option
                                    >
                                {/each}
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="subcategory">Subcategory:</label>
                            <select
                                id="subcategory"
                                bind:value={selectedSubcategory}
                                disabled={!selectedCategory ||
                                    selectedReport.type === "negative_example"}
                                class="form-select"
                            >
                                <option value={null}>Select Subcategory</option>
                                {#each subcategories as subcategory}
                                    <option value={subcategory.name}
                                        >{subcategory.name}</option
                                    >
                                {/each}
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="productType">Product Type:</label>
                            <select
                                id="productType"
                                bind:value={selectedProductType}
                                disabled={!selectedSubcategory ||
                                    subcategories.find(
                                        (s) => s.name === selectedSubcategory,
                                    )?.gridOnly ||
                                    selectedReport.type === "negative_example"}
                                class="form-select"
                            >
                                {#if subcategories.find((s) => s.name === selectedSubcategory)?.gridOnly}
                                    <option value={selectedSubcategory}
                                        >{selectedSubcategory}</option
                                    >
                                {:else if productTypes && productTypes.length > 0}
                                    <option value={null}
                                        >Select Product Type</option
                                    >
                                    {#each productTypes as type}
                                        <option value={type}>{type}</option>
                                    {/each}
                                {:else if selectedSubcategory}
                                    <option value={null}
                                        >No product types defined</option
                                    >
                                {/if}
                            </select>
                        </div>
                    </div>
                {:else}
                    <!-- User-suggested category, already reviewed by user -->
                    <div class="report-section">
                        <h3>Suggested Categorization (by User)</h3>
                        <ul>
                            <li>
                                <strong>Category:</strong>
                                {selectedReport.suggestedCategory.category}
                            </li>
                            <li>
                                <strong>Subcategory:</strong>
                                {selectedReport.suggestedCategory.subcategory ||
                                    "N/A"}
                            </li>
                            <li>
                                <strong>Product Type:</strong>
                                {selectedReport.suggestedCategory
                                    .product_type ||
                                    selectedReport.suggestedCategory
                                        .subcategory ||
                                    "N/A"}
                            </li>
                        </ul>
                    </div>
                {/if}

                {#if selectedReport.notes}
                    <div class="report-section">
                        <h3>Notes</h3>
                        <p>{selectedReport.notes}</p>
                    </div>
                {/if}

                <div class="action-buttons">
                    <button class="reject-btn" on:click={() => rejectReport()}>
                        Reject
                    </button>

                    <button
                        class="approve-btn"
                        on:click={() => approveReport()}
                    >
                        {selectedReport.type === "negative_example"
                            ? "Confirm as Incorrect & Re-evaluate"
                            : "Approve Suggestion"}
                    </button>

                    <button
                        class="cancel-btn"
                        on:click={() => {
                            showApproveDialog = false;
                            selectedReport = null;
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}

<!-- Sync Status Modal (MOVED FROM SIDEBAR) -->
{#if syncStatusModalOpen}
    <div
        class="sync-modal-overlay"
        use:clickable={() => {
            if (!syncStatus.inProgress) {
                syncStatusModalOpen = false;
            }
        }}
    >
        <div
            class="sync-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="syncDialogTitle"
            on:click|stopPropagation
            on:keydown|stopPropagation
        >
            <div class="sync-modal-header">
                <h3 id="syncDialogTitle">DHT Synchronization Status</h3>
                {#if !syncStatus.inProgress}
                    <button
                        class="close-button"
                        on:click={() => (syncStatusModalOpen = false)}
                    >
                        <X size={20} />
                    </button>
                {/if}
            </div>

            <div class="sync-modal-content">
                {#if syncStatus.inProgress}
                    <div class="sync-status">
                        <div class="sync-spinner"></div>
                        <p class="sync-message">{syncStatus.message}</p>
                    </div>

                    <div class="progress-container">
                        <div
                            class="progress-bar"
                            style="width: {syncStatus.progress}%"
                        ></div>
                    </div>

                    <p class="sync-count">
                        {syncStatus.completedUpdates} / {syncStatus.totalToUpdate}
                        product types processed
                    </p>
                {:else if syncStatus.message.includes("error") || syncStatus.message.includes("Error")}
                    <div class="sync-error">
                        <AlertCircle size={32} color="#ff5555" />
                        <p class="sync-message">{syncStatus.message}</p>
                    </div>
                {:else}
                    <div class="sync-success">
                        <p class="sync-message">{syncStatus.message}</p>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .admin-container {
        width: 100vw;
        height: 100vh;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: fixed;
        top: 0;
        left: 0;
        background-color: var(--background, white);
        z-index: var(--z-index-overlay, 2000);
    }

    .table-container {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        width: 100%;
        box-sizing: border-box;
    }

    /* NEW DATA ADMIN SECTION STYLES */
    .data-admin-actions {
        margin: 0;
        padding: var(--spacing-md, 15px) var(--spacing-lg, 20px);
        background-color: var(--surface-variant, #e8eaf6);
        border-radius: 0;
        display: flex;
        flex-direction: column;
        position: relative;
        box-shadow: var(--shadow-subtle, 0 2px 8px rgba(0, 0, 0, 0.08));
        border-bottom: var(--border-width-thin, 1px) solid var(--border, #eee);
    }

    .data-admin-title {
        font-size: var(--font-size-lg, 18px);
        margin: 0 0 var(--spacing-sm, 10px) 0;
        color: var(--text-primary);
        font-weight: var(--font-weight-semibold);
    }

    .data-admin-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-md, 15px);
    }

    .data-admin-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm, 8px);
        padding: var(--spacing-sm, 8px) var(--spacing-md, 15px);
        border: none;
        border-radius: var(--btn-border-radius, 4px);
        background-color: var(--primary, #3f51b5);
        color: white;
        cursor: pointer;
        font-weight: var(--font-weight-semibold);
        transition: var(--btn-transition, 0.2s);
    }

    .data-admin-btn:hover {
        opacity: 0.9;
        transform: translateY(-1px);
    }

    .btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    /* END NEW STYLES */

    .admin-actions {
        margin: 0;
        padding: var(--spacing-md, 15px) var(--spacing-lg, 20px);
        background-color: var(--surface, #f8f9fa);
        border-radius: 0; /* No border radius for a bar look */
        display: flex;
        align-items: flex-start; /* Align items to the start */
        gap: var(--spacing-xl, 40px); /* Increased gap */
        position: sticky;
        top: 72px; /* Height of the admin-header */
        z-index: 9;
        flex-wrap: wrap; /* Allow actions to wrap on smaller screens */
        box-shadow: var(--shadow-subtle, 0 2px 8px rgba(0, 0, 0, 0.08));
    }

    .action-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs, 10px); /* Spacing within group */
        min-width: 200px; /* Ensure buttons don't get too squished */
    }

    .approve-all-btn,
    .process-queue-btn,
    .convert-btn {
        padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
        color: white;
        border: none;
        border-radius: var(--btn-border-radius, 4px);
        cursor: pointer;
        font-weight: var(--font-weight-bold, bold);
        transition: var(--btn-transition, 0.2s);
    }

    .approve-all-btn {
        background-color: var(--primary, #28a745);
    }
    .process-queue-btn {
        background-color: var(--secondary, #007bff);
    }
    .convert-btn {
        background-color: var(--accent, #17a2b8);
    }

    .approve-all-btn:hover:not(:disabled),
    .process-queue-btn:hover:not(:disabled),
    .convert-btn:hover:not(:disabled) {
        opacity: 0.9;
    }

    .approve-all-btn:disabled,
    .process-queue-btn:disabled,
    .convert-btn:disabled {
        background-color: var(--btn-disabled, #adb5bd);
        cursor: not-allowed;
    }

    .hint {
        color: var(--text-secondary, #6c757d);
        font-size: var(--font-size-sm, 14px);
        margin: 0;
    }

    .error-message {
        background-color: var(--error-light, #ffecec);
        color: var(--error, #721c24); /* Darker red for text */
        padding: var(--spacing-sm, 10px);
        border-radius: var(--card-border-radius, 4px);
        margin: var(--spacing-md, 15px) var(--spacing-lg, 20px); /* Consistent margins */
    }

    .reports-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
    }

    .reports-table th,
    .reports-table td {
        padding: var(--spacing-sm, 10px);
        border: var(--border-width-thin, 1px) solid var(--border, #ddd);
        text-align: left;
        vertical-align: middle; /* Better alignment for multi-line content */
        overflow: hidden;
        text-overflow: ellipsis;
        word-wrap: break-word;
    }

    .reports-table th {
        background-color: var(
            --surface,
            #f5f5f5
        ); /* Slightly lighter than default SvelteKit */
        font-weight: var(--font-weight-bold, bold);
    }

    .reports-table thead {
        position: sticky;
        top: 0; /* Stick to the top of the container */
        background-color: var(--surface, #f5f5f5); /* Match th background */
        z-index: 5;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); /* Subtle shadow for separation */
    }

    .reports-table tr:nth-child(even) {
        background-color: var(
            --surface-hover,
            #f9f9f9
        ); /* Lighter for even rows */
    }

    .system-row {
        background-color: var(
            --system-row,
            #f0f4ff
        ) !important; /* Distinct color for system rows */
    }

    /* Column widths */
    .reports-table th:nth-child(1) {
        /* Image column */
        width: 80px;
    }

    .reports-table th:nth-child(2) {
        /* Product column */
        width: 15%;
    }

    .reports-table th:nth-child(3),
    .reports-table th:nth-child(4) {
        /* Category columns */
        width: 25%;
    }

    .reports-table th:nth-child(5),
    .reports-table th:nth-child(6) {
        /* Status & Source columns */
        width: 10%;
    }

    .reports-table th:nth-child(7) {
        /* Actions column */
        width: 15%;
    }

    .image-cell {
        text-align: center;
        width: 80px;
    }

    .product-thumbnail {
        width: 60px;
        height: 60px;
        object-fit: contain;
        background-color: white;
        border: 1px solid var(--border);
        border-radius: var(--card-border-radius, 4px);
    }

    .no-image-placeholder {
        width: 60px;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--surface-hover);
        color: var(--text-secondary);
        font-size: 12px;
        border-radius: var(--card-border-radius, 4px);
        margin: 0 auto;
    }

    .badge {
        display: inline-block;
        padding: 4px 8px; /* Slightly more padding */
        border-radius: var(--badge-border-radius, 12px); /* More pill-shaped */
        font-size: var(--font-size-xs, 12px);
        font-weight: var(--font-weight-semibold, 500); /* Slightly bolder */
        line-height: 1.2; /* Ensure text fits well */
        white-space: nowrap;
    }

    /* Badge color definitions (using more distinct colors) */
    .badge-pending {
        background-color: #fff3cd;
        color: #664d03;
        border: 1px solid #ffecb5;
    }
    .badge-success {
        background-color: #d1e7dd;
        color: #0a3622;
        border: 1px solid #badbcc;
    }
    .badge-danger {
        background-color: #f8d7da;
        color: #58151c;
        border: 1px solid #f1c2c7;
    }
    .badge-info {
        background-color: #cff4fc;
        color: #055160;
        border: 1px solid #b6effb;
    }
    .badge-warning {
        background-color: #fff3cd;
        color: #664d03;
        border: 1px solid #ffecb5;
    } /* Same as pending for now */

    .badge-system {
        background-color: #e2e3fe;
        color: #303655;
        border: 1px solid #d3d5fd;
    }
    .badge-user {
        background-color: #cfe2ff;
        color: #042f66;
        border: 1px solid #b9d3ff;
    }

    .badge-negative {
        background-color: #f5c6cb;
        color: #721c24;
        border: 1px solid #f1b0b7;
    }
    .badge-suggestion {
        background-color: #b6d7a8;
        color: #274e13;
        border: 1px solid #a2c896;
    }
    .badge-default {
        background-color: #e9ecef;
        color: #495057;
        border: 1px solid #dee2e6;
    }

    .needs-review {
        color: var(--warning, #dc3545); /* Bootstrap warning color */
        font-weight: var(--font-weight-bold, bold);
    }

    .actions-cell {
        text-align: center;
    }

    .action-buttons {
        display: flex;
        justify-content: center;
        gap: var(--spacing-xs, 5px);
    }

    .view-btn {
        padding: var(--spacing-xs, 5px) var(--spacing-sm, 10px);
        background-color: var(--secondary, #007bff); /* Bootstrap secondary */
        color: white;
        border: none;
        border-radius: var(--btn-border-radius, 4px);
        cursor: pointer;
        transition: var(--btn-transition, 0.2s);
    }

    .view-btn:hover:not(:disabled) {
        opacity: 0.9;
    }

    .view-btn:disabled {
        background-color: var(--btn-disabled, #cccccc);
        cursor: not-allowed;
    }

    .approve-quick-btn,
    .reject-quick-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        transition: var(--btn-transition);
    }

    .approve-quick-btn {
        background-color: var(--success, #28a745);
        color: white;
    }

    .reject-quick-btn {
        background-color: var(--error, #dc3545);
        color: white;
    }

    .approve-quick-btn:hover,
    .reject-quick-btn:hover {
        opacity: 0.85;
        transform: scale(1.05);
    }

    .overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(
            --overlay-dark,
            rgba(0, 0, 0, 0.6)
        ); /* Darker overlay */
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: var(--z-index-modal, 1050); /* Bootstrap modal z-index */
        touch-action: none; /* Prevent touch scrolling */
    }

    .dialog {
        background-color: var(--background, white);
        padding: var(--spacing-lg, 20px);
        border-radius: var(--card-border-radius, 8px);
        width: 90%;
        max-width: 800px; /* Max width for larger screens */
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: var(
            --shadow-lg,
            0 0.5rem 1rem rgba(0, 0, 0, 0.15)
        ); /* Larger shadow */
    }

    .dialog h2 {
        margin-top: 0;
        margin-bottom: var(--spacing-lg, 20px);
        font-size: var(--font-size-lg, 22px); /* Larger dialog title */
    }

    .report-details {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg, 20px);
    }

    .report-section {
        padding: var(--spacing-md, 15px);
        background-color: var(--surface, #f9f9f9);
        border-radius: var(--card-border-radius, 4px);
        border: var(--border-width-thin, 1px) solid var(--border, #eee);
    }

    .report-section h3 {
        margin-top: 0;
        margin-bottom: var(--spacing-md, 10px);
        font-size: var(--font-size-md, 18px);
    }

    .system-section {
        background-color: var(--system-section-bg, #f0f4ff);
        border-left: 4px solid var(--system-section-border, #3f51b5);
    }

    .system-note {
        color: var(--system-section-text, #3f51b5);
        font-style: italic;
        margin-bottom: var(--spacing-md, 15px);
        font-size: var(--font-size-sm, 14px);
    }

    .form-group {
        margin-bottom: var(--spacing-md, 15px);
    }

    .form-group label {
        display: block;
        margin-bottom: var(--spacing-xs, 5px);
        font-weight: var(
            --font-weight-semibold,
            600
        ); /* Slightly less than bold */
    }

    .form-select {
        width: 100%;
        padding: var(--spacing-sm, 8px) var(--spacing-md, 12px); /* More padding */
        border: var(--border-width-thin, 1px) solid var(--border, #ced4da); /* Bootstrap form control border */
        border-radius: var(--form-border-radius, 4px);
        background-color: var(--background, white);
        height: auto; /* Allow natural height based on padding */
        line-height: 1.5;
        font-size: var(--font-size-base, 16px);
    }

    .form-select:disabled {
        background-color: var(
            --input-disabled,
            #e9ecef
        ); /* Bootstrap disabled color */
        cursor: not-allowed;
        opacity: 0.7;
    }

    .product-img {
        max-width: 200px;
        max-height: 200px;
        object-fit: contain;
        margin-top: var(--spacing-sm, 10px);
        border: var(--border-width-thin, 1px) solid var(--border, #ddd);
        border-radius: var(--card-border-radius, 4px);
        padding: var(--spacing-xs, 5px);
        background-color: white; /* Ensure background for transparent images */
    }

    .no-image {
        width: 200px;
        height: 200px;
        background-color: var(--surface-hover, #f0f0f0);
        border: var(--border-width-thin, 1px) dashed var(--border, #ccc);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: var(--spacing-sm, 10px);
        margin-top: var(--spacing-sm, 10px);
        text-align: center;
        border-radius: var(--card-border-radius, 4px);
    }
    .no-image p {
        margin: 5px 0;
    }

    .product-name {
        /* Used inside .no-image */
        font-weight: var(--font-weight-bold, bold);
        margin-top: var(--spacing-xs, 10px);
        font-size: var(--font-size-sm, 14px);
        color: var(--text-secondary, #666);
    }

    .action-buttons {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm, 10px);
        margin-top: var(--spacing-lg, 20px);
        flex-wrap: wrap; /* Ensure buttons wrap on small screens */
    }

    .approve-btn,
    .reject-btn,
    .cancel-btn {
        padding: var(--spacing-sm, 10px) var(--spacing-md, 20px); /* Larger buttons */
        border: none;
        border-radius: var(--btn-border-radius, 4px);
        cursor: pointer;
        transition: var(--btn-transition, 0.2s);
        font-weight: var(--font-weight-semibold, 500);
    }

    .approve-btn {
        background-color: var(--primary, #28a745);
        color: white;
    }
    .approve-btn:hover {
        opacity: 0.85;
    }

    .reject-btn {
        background-color: var(--error, #dc3545);
        color: white;
    }
    .reject-btn:hover {
        opacity: 0.85;
    }

    .cancel-btn {
        background-color: var(--light-gray, #6c757d);
        color: white;
    } /* Bootstrap secondary-like */
    .cancel-btn:hover {
        background-color: #5a6268;
    }

    .admin-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 0;
        width: 100%; /* Ensure it spans full width */
        position: sticky;
        top: 0;
        background: var(--background, white); /* Ensure it has a background */
        z-index: 10;
        padding: var(--spacing-lg, 20px);
        height: 72px; /* Fixed height to match your app's header */
        box-sizing: border-box;
        border-bottom: var(--border-width-thin, 1px) solid var(--border, #eee);
        box-shadow: var(--shadow-subtle, 0 2px 8px rgba(0, 0, 0, 0.08));
    }

    .admin-header h1 {
        margin: 0;
        padding: 0;
        font-size: var(--font-size-xl, 24px);
    }

    .close-btn {
        background: none;
        border: none;
        font-size: var(--font-size-xl, 24px); /* Make it larger */
        cursor: pointer;
        padding: var(--spacing-xs, 5px) var(--spacing-sm, 10px);
        border-radius: var(--btn-border-radius, 4px);
        line-height: 1; /* Prevent extra space */
    }
    .close-btn:hover {
        background-color: var(--surface-hover, #f1f1f1);
    }

    .negative-example {
        color: var(--error, #dc3545); /* Use error color */
        font-weight: var(--font-weight-bold, bold);
    }

    .loading,
    .no-data {
        padding: var(--spacing-xl, 40px) var(--spacing-lg, 20px); /* More padding */
        text-align: center;
        color: var(--text-secondary, #6c757d);
        font-size: var(--font-size-lg, 18px); /* Larger text */
    }
    .no-data {
        font-style: italic;
    }

    /* Sync Modal Styles (MOVED FROM SIDEBAR) */
    .sync-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 3000;
    }

    .sync-modal {
        background: var(--background);
        border-radius: var(--border-radius);
        width: 90%;
        max-width: 500px;
        box-shadow: var(--shadow-large);
    }

    .sync-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: var(--border-width-thin) solid var(--border);
    }

    .sync-modal-header h3 {
        margin: 0;
        color: var(--text-primary);
    }

    .sync-modal-content {
        padding: var(--spacing-lg);
    }

    .sync-status {
        display: flex;
        align-items: center;
        margin-bottom: var(--spacing-md);
    }

    .sync-spinner {
        width: 24px;
        height: 24px;
        border: 3px solid rgba(0, 0, 0, 0.1);
        border-radius: 50%;
        border-top-color: var(--primary);
        animation: spin 1s linear infinite;
        margin-right: var(--spacing-md);
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .sync-message {
        font-size: var(--font-size-md);
        color: var(--text-primary);
        margin: 0;
    }

    .progress-container {
        height: 8px;
        background-color: var(--border);
        border-radius: 4px;
        margin: var(--spacing-md) 0;
        overflow: hidden;
    }

    .progress-bar {
        height: 100%;
        background-color: var(--primary);
        transition: width 0.3s ease;
    }

    .sync-count {
        text-align: center;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
    }

    .sync-error,
    .sync-success {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--spacing-md);
    }

    .close-button {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-secondary);
    }

    .close-button:hover {
        color: var(--text-primary);
    }
</style>
