<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { ChevronsLeft, ChevronsRight } from "lucide-svelte";
    import { productDataService } from "../../products/services/ProductDataService";

    export let direction: "left" | "right";
    export let disabled: boolean = false;
    export let currentRanges: Record<string, any>;
    export let totalProducts: Record<string, any>;
    export let identifier: string;
    export let selectedCategory: string;
    export let selectedSubcategory: string;
    export let mainGridContainer: HTMLElement;
    export let isProductType = false;
    export let hasMore = true;
    export let containerCapacity: number;

    const dispatch = createEventDispatcher();
    let isNavigating = false;

    // Handle navigation
    async function handleNavigation() {
        if (!productDataService || !mainGridContainer || disabled || isNavigating) {
            return;
        }

        isNavigating = true;

        try {
            dispatch("loading", { identifier, loading: true });

            // Let the service handle all navigation logic
            const result = await productDataService.navigate(direction, {
                category: selectedCategory,
                identifier,
                isProductType,
                selectedSubcategory,
                currentRanges,
                totalProducts,
                containerCapacity,
            });

            // Emit the result
            dispatch("dataLoaded", result);

            // Check if boundaries were initialized for the first time
            if (!totalProducts[identifier] && result.total) {
                dispatch("boundariesInitialized", {
                    identifier: identifier,
                    grandTotal: result.total,
                });
            }
        } catch (error) {
            console.error(`Navigation error (${direction}):`, error);
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            dispatch("navigationError", { error: errorMessage, identifier });
        } finally {
            dispatch("loading", { identifier, loading: false });
            isNavigating = false;
        }
    }

    // Override disabled logic for right arrow to use hasMore
    $: if (direction === "right") {
        const atEnd =
            currentRanges[identifier]?.end >= totalProducts[identifier];

        disabled = !hasMore && atEnd;
    }
</script>

<button
    class="nav-arrow-btn {direction} btn btn-icon {disabled ? 'disabled' : ''}"
    {disabled}
    on:click={handleNavigation}
>
    {#if direction === "left"}
        <ChevronsLeft size={24} />
    {:else}
        <ChevronsRight size={24} />
    {/if}
</button>

<style>
    .nav-arrow-btn.left {
        left: 0px;
    }

    .nav-arrow-btn.right {
        right: 0px;
    }
</style>
