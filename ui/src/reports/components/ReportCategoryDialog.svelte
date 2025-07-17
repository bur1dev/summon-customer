<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from "svelte";
    import { mainCategories } from "../../products/utils/categoryData";
    import { X } from "lucide-svelte";
    import { clickable } from "../../shared/actions/clickable";

    const dispatch = createEventDispatcher();
    
    // Import NavigationStore for current navigation state
    import { navigationStore } from "../../stores/NavigationStore";

    export let product: any;
    export let isOpen: boolean = false;

    let selectedCategory: string | null = null;
    let selectedSubcategory: string | null = null;
    let selectedProductType: string | null = null;
    let unsubscribeNavigation: (() => void) | null = null;
    let notes: string = "";
    let reportType: string = "suggestion"; // Default to suggestion type (can be "suggestion" or "incorrect")
    let isClosing: boolean = false; // Animation state for smooth closing

    let subcategories: any[] = [];
    let productTypes: string[] = [];

    // Reactive statements to update options
    $: {
        subcategories =
            mainCategories.find((c: any) => c.name === selectedCategory)
                ?.subcategories || [];
        // Reset subcategory when category changes
        if (
            selectedSubcategory &&
            !subcategories.find((s: any) => s.name === selectedSubcategory)
        ) {
            selectedSubcategory = null;
        }
    }

    $: {
        const subcategory = subcategories.find(
            (s: any) => s.name === selectedSubcategory,
        );
        productTypes = subcategory?.productTypes || [];

        // Check if this is a gridOnly subcategory
        if (subcategory?.gridOnly) {
            // For gridOnly subcategories, product_type to subcategory name
            selectedProductType = selectedSubcategory;
        }
        // Reset product type when subcategory changes
        else if (
            selectedProductType &&
            !productTypes.includes(selectedProductType)
        ) {
            selectedProductType = null;
        }
    }

    onMount(() => {
        if (isOpen && product) {
            // Log the product object when the dialog opens
            try {
                console.log(
                    "[ReportCategoryDialog] Received product prop:",
                    JSON.parse(JSON.stringify(product)),
                );
            } catch (e) {
                console.error(
                    "[ReportCategoryDialog] Error stringifying received product prop:",
                    e,
                );
                console.log(
                    "[ReportCategoryDialog] Raw received product prop:",
                    product,
                );
            }
        }

        // Get values from navigation state when component mounts
        unsubscribeNavigation = navigationStore.subscribe((navState: any) => {
            if (navState.category) {
                selectedCategory = navState.category;
                selectedSubcategory = navState.subcategory;
                selectedProductType = navState.productType;
            } else {
                // Fall back to product's category if no navigation state
                if (product) {
                    // Ensure product exists
                    selectedCategory = product.category;

                    // Pre-select subcategory only when no stored selection
                    if (isOpen && selectedCategory) {
                        selectedSubcategory = product.subcategory;
                        selectedProductType =
                            product.product_type || product.subcategory;
                    }
                }
            }
        });

        return () => {
            // Clean up navigation subscription
            if (unsubscribeNavigation) unsubscribeNavigation();
            if (isOpen) {
                // Ensure overflow is reset if dialog was open
                document.body.style.overflow = "";
            }
        };
    });

    function handleSubmit() {
        // Note: We no longer update a store since navigation state is read-only
        // The current category selection is now handled by the navigation service

        // Create a defensive copy of the product prop to ensure we don't modify the original
        // and to explicitly check for productId.
        const productPayload = product ? { ...product } : {};

        // Log the product object that will be part of the dispatched event
        try {
            console.log(
                "[ReportCategoryDialog] Product object being dispatched:",
                JSON.parse(JSON.stringify(productPayload)),
            );
            if (productPayload.hasOwnProperty("productId")) {
                console.log(
                    "[ReportCategoryDialog] Dispatching with productId:",
                    productPayload.productId,
                );
            } else {
                console.warn(
                    "[ReportCategoryDialog] Dispatching WITHOUT productId. Product object:",
                    productPayload,
                );
            }
        } catch (e) {
            console.error(
                "[ReportCategoryDialog] Error stringifying productPayload for dispatch log:",
                e,
            );
            console.log(
                "[ReportCategoryDialog] Raw productPayload for dispatch log:",
                productPayload,
            );
        }

        if (reportType === "suggestion") {
            // Submit with suggested category
            dispatch("submit", {
                product: productPayload, // Use the payload
                currentCategory: {
                    category: productPayload.category, // Use payload's current category
                    subcategory: productPayload.subcategory,
                    product_type:
                        productPayload.product_type ||
                        productPayload.subcategory,
                },
                suggestedCategory: {
                    category: selectedCategory,
                    subcategory: selectedSubcategory,
                    product_type: selectedProductType || selectedSubcategory,
                },
                notes: notes,
                timestamp: new Date().toISOString(),
                type: "suggestion",
            });
        } else {
            // Just report as incorrect without suggestion
            handleIncorrectReport();
        }

        closeModal();
    }

    function closeModal() {
        isClosing = true;
        setTimeout(() => {
            isOpen = false;
            isClosing = false;
            document.body.style.overflow = ""; // Re-enable scrolling
            notes = "";
            reportType = "suggestion"; // Reset for next time
        }, 300); // Match the CSS animation duration
    }

    function handleClose() {
        closeModal();
    }

    function handleIncorrectReport() {
        const productPayloadForIncorrect = product ? { ...product } : {};
        fetch("http://localhost:3000/api/report-incorrect-category", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                product: productPayloadForIncorrect,
                currentCategory: {
                    category: productPayloadForIncorrect.category,
                    subcategory: productPayloadForIncorrect.subcategory,
                    product_type:
                        productPayloadForIncorrect.product_type ||
                        productPayloadForIncorrect.subcategory,
                },
                timestamp: new Date().toISOString(),
            }),
        })
            .then((response) => {
                if (response.ok) {
                    alert("Report submitted successfully");
                } else {
                    throw new Error("Failed to submit report");
                }
            })
            .catch((error) => {
                console.error("Error submitting report:", error);
                alert("Error submitting report");
            });

        closeModal();
    }

    function setReportType(type: string) {
        reportType = type;
    }


    function handleOverlayKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            handleClose();
        }
    }

    // Portal functionality to mount dialog to body
    function portal(node: HTMLElement) {
        const target = document.body;
        let appended = false; // Track if node is appended

        function update() {
            if (!appended) {
                // Only append if not already appended
                target.appendChild(node);
                appended = true;
            }
        }

        function destroy() {
            if (appended && node.parentNode) {
                // Only remove if it was appended and still has a parent
                node.parentNode.removeChild(node);
                appended = false;
            }
        }

        if (isOpen) {
            // Ensure portal is active if dialog is open
            update();
        }

        return {
            destroy,
            // Svelte might call update if isOpen changes, ensure it doesn't re-append
            update: (newIsOpen: boolean) => {
                if (newIsOpen && !appended) {
                    target.appendChild(node);
                    appended = true;
                } else if (!newIsOpen && appended && node.parentNode) {
                    // Optional: remove when not open, but portal usually keeps it until destroy
                    // node.parentNode.removeChild(node);
                    // appended = false;
                }
            },
        };
    }

    // Handle body overflow when dialog opens/closes
    // This $: block will react to changes in `isOpen`
    $: {
        if (typeof document !== "undefined") {
            // Ensure document is available (for SSR safety, though likely not an issue here)
            if (isOpen) {
                document.body.style.overflow = "hidden"; // Disable scrolling when open
            } else {
                // Only reset if no other modal or overlay is managing overflow
                // This simple reset is fine if this is the only modal component
                document.body.style.overflow = "";
            }
        }
    }

    // onDestroy should also ensure overflow is reset
    onDestroy(() => {
        if (typeof document !== "undefined") {
            document.body.style.overflow = "";
        }
        if (unsubscribeNavigation) {
            unsubscribeNavigation();
        }
    });
</script>

{#if isOpen}
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
        class="overlay {isClosing ? 'fade-out' : 'fade-in'}"
        on:click|self={handleClose}
        on:keydown={handleOverlayKeydown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        use:portal
    >
        <div class="dialog-content {isClosing ? 'scale-out' : 'scale-in'}">
            <div class="dialog-header">
                <h2 id="dialog-title">Report Incorrect Category</h2>
                <button
                    class="btn btn-icon btn-icon-primary btn-icon-sm"
                    on:click={handleClose}
                    aria-label="Close dialog"
                >
                    <X size={20} />
                </button>
            </div>

            <div class="dialog-body">
                <div class="product-info-card">
                    <p><strong>Product:</strong> {product.name}</p>
                    <p>
                        <strong>Current Category:</strong>
                        {product.category} → {product.subcategory} → {product.product_type ||
                            product.subcategory}
                    </p>

                    {#if product.image_url}
                        <img
                            src={product.image_url}
                            alt={product.name}
                            class="product-image"
                        />
                    {:else}
                        <div class="product-image-placeholder">
                            <p>No image available</p>
                            <p class="placeholder-product-name">
                                {product.name}
                            </p>
                        </div>
                    {/if}
                </div>

                <div class="report-type-selector">
                    <div class="report-option-title">
                        What would you like to do?
                    </div>
                    <div class="report-options">
                        <div
                            class="report-option {reportType === 'incorrect'
                                ? 'selected'
                                : ''}"
                            use:clickable={() => setReportType("incorrect")}
                        >
                            <div class="report-option-heading">
                                Just flag as incorrect
                            </div>
                            <div class="report-option-description">
                                Report that this product is in the wrong
                                category without suggesting the correct one.
                            </div>
                        </div>

                        <div
                            class="report-option {reportType === 'suggestion'
                                ? 'selected'
                                : ''}"
                            use:clickable={() => setReportType("suggestion")}
                        >
                            <div class="report-option-heading">
                                Suggest correct category
                            </div>
                            <div class="report-option-description">
                                Report this product and suggest where it should
                                be categorized.
                            </div>
                        </div>
                    </div>
                </div>

                {#if reportType === "suggestion"}
                    <div class="form-container">
                        <div class="form-group">
                            <label for="category-select"
                                >Suggested Category:</label
                            >
                            <select
                                id="category-select"
                                bind:value={selectedCategory}
                                class="form-select"
                            >
                                {#each mainCategories as category}
                                    <option value={category.name}
                                        >{category.name}</option
                                    >
                                {/each}
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="subcategory-select"
                                >Suggested Subcategory:</label
                            >
                            <select
                                id="subcategory-select"
                                bind:value={selectedSubcategory}
                                class="form-select"
                            >
                                {#each subcategories as subcategory}
                                    <option value={subcategory.name}
                                        >{subcategory.name}</option
                                    >
                                {/each}
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="productType-select"
                                >Suggested Product Type:</label
                            >
                            <select
                                id="productType-select"
                                bind:value={selectedProductType}
                                class="form-select"
                                disabled={!selectedSubcategory ||
                                    subcategories.find(
                                        (s) => s.name === selectedSubcategory,
                                    )?.gridOnly}
                            >
                                {#if subcategories.find((s) => s.name === selectedSubcategory)?.gridOnly}
                                    <option value={selectedSubcategory}
                                        >{selectedSubcategory}</option
                                    >
                                {:else if productTypes && productTypes.length > 0}
                                    {#each productTypes as type}
                                        <option value={type}>{type}</option>
                                    {/each}
                                {/if}
                            </select>
                        </div>
                    </div>
                {/if}

                <div class="form-group">
                    <label for="notes-area">Notes (optional):</label>
                    <textarea
                        id="notes-area"
                        bind:value={notes}
                        class="form-textarea"
                        placeholder="Why should this product be in a different category?"
                    ></textarea>
                </div>
            </div>

            <div class="dialog-actions">
                <button class="btn btn-secondary btn-md" on:click={handleClose}
                    >Cancel</button
                >
                <button
                    class="btn btn-primary btn-md"
                    on:click={handleSubmit}
                    disabled={reportType === "suggestion" &&
                        (!selectedCategory || !selectedSubcategory)}
                >
                    Submit Report
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--overlay-dark);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: var(--z-index-modal);
        padding: var(--spacing-md);
        touch-action: none; /* Prevent touch scrolling */
    }

    .overlay.fade-in {
        animation: fadeIn var(--fade-in-duration) ease forwards;
    }

    .overlay.fade-out {
        animation: fadeOut var(--transition-fast) ease forwards;
    }

    .dialog-content {
        background-color: var(--background);
        padding: 0;
        border-radius: var(--card-border-radius);
        width: 100%;
        max-width: 550px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        box-shadow: var(--shadow-medium);
        overflow: hidden; /* Prevents content from spilling out before scroll */
    }

    .dialog-content.scale-in {
        animation: scaleIn var(--transition-normal) ease forwards;
    }

    .dialog-content.scale-out {
        animation: scaleOut var(--transition-normal) ease forwards;
    }

    .dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: var(--border-width-thin) solid var(--border);
        background-color: var(--surface);
        min-height: var(--component-header-height);
        box-sizing: border-box;
    }

    .dialog-header h2 {
        margin: 0;
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .dialog-body {
        padding: var(--spacing-lg);
        overflow-y: auto;
        flex-grow: 1;
    }

    .product-info-card {
        background-color: var(--surface);
        padding: var(--spacing-md);
        border-radius: var(--card-border-radius);
        margin-bottom: var(--spacing-lg);
        border: var(--border-width-thin) solid var(--border-lighter);
    }

    .product-info-card p {
        margin: 0 0 var(--spacing-xs) 0;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
    }
    .product-info-card p strong {
        color: var(--text-primary);
        font-weight: var(--font-weight-semibold);
    }

    .product-image {
        max-width: 150px;
        max-height: 150px;
        width: auto;
        height: auto;
        object-fit: contain;
        margin-top: var(--spacing-sm);
        border-radius: var(--card-border-radius);
        background-color: var(--background);
        padding: var(--spacing-xs);
        border: var(--border-width-thin) solid var(--border);
    }

    .product-image-placeholder {
        width: 150px;
        height: 150px;
        background-color: var(--surface-hover);
        border: var(--border-width-thin) dashed var(--border);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: var(--spacing-sm);
        margin-top: var(--spacing-sm);
        text-align: center;
        border-radius: var(--card-border-radius);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
    }

    .placeholder-product-name {
        font-weight: var(--font-weight-semibold);
        margin-top: var(--spacing-xs);
        color: var(--text-primary);
    }

    .form-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
    }

    .form-group {
        display: flex;
        flex-direction: column;
        margin-bottom: var(--spacing-md);
    }

    .form-group label {
        margin-bottom: var(--spacing-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
    }

    .form-select,
    .form-textarea {
        width: 100%;
        padding: var(--spacing-sm);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(
            --card-border-radius
        ); /* Consistent with cards, less round than buttons */
        background-color: var(--background);
        color: var(--text-primary);
        font-size: var(--font-size-md);
        box-sizing: border-box;
        transition: var(--btn-transition);
        height: var(--btn-height-md); /* For select */
    }
    .form-select {
        appearance: none; /* For custom arrow if desired */
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23666666'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right var(--spacing-sm) center;
        background-size: 1.2em;
        padding-right: calc(
            var(--spacing-sm) + 1.5em
        ); /* Make space for arrow */
    }

    .form-textarea {
        min-height: 100px;
        resize: vertical;
        height: auto; /* Overrides fixed height for textarea */
    }

    .form-select:focus,
    .form-textarea:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 2px rgba(0, 175, 185, 0.2); /* var(--primary) as rgba */
    }

    .form-select:disabled {
        background-color: var(--surface-hover);
        cursor: not-allowed;
        opacity: 0.7;
    }

    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        padding: var(--spacing-md) var(--spacing-lg);
        border-top: var(--border-width-thin) solid var(--border);
        background-color: var(--surface);
    }

    /* Report type selector */
    .report-type-selector {
        margin-bottom: var(--spacing-lg);
    }

    .report-option-title {
        font-weight: var(--font-weight-semibold);
        margin-bottom: var(--spacing-sm);
        color: var(--text-primary);
    }

    .report-options {
        display: flex;
        gap: var(--spacing-md);
        flex-direction: column;
    }

    .report-option {
        padding: var(--spacing-md);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--card-border-radius);
        background-color: var(--surface);
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .report-option:hover {
        background-color: var(--surface-hover);
    }

    .report-option.selected {
        border-color: var(--primary);
        background-color: rgba(0, 175, 185, 0.05);
        box-shadow: 0 0 0 1px var(--primary);
    }

    .report-option-heading {
        font-weight: var(--font-weight-semibold);
        margin-bottom: var(--spacing-xs);
        color: var(--text-primary);
    }

    .report-option-description {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
    }

    @media (min-width: 768px) {
        .report-options {
            flex-direction: row;
        }

        .report-option {
            flex: 1;
        }
    }
</style>
