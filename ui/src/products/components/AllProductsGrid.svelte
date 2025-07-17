<script lang="ts">
    import { getContext, onMount, onDestroy } from "svelte";
    import ProductCard from "./ProductCard.svelte";
    import { createEventDispatcher } from "svelte";
    import SortFilterDropdown from "../../shared/components/SortFilterDropdown.svelte";
    import { filterState, getSortedFilteredProducts, setSortBy, setSelectedBrands, setSelectedOrganic } from "../../stores/SortingStore";


    import { mainCategories } from "../utils/categoryData";
    import { useResizeObserver } from "../../shared/utils/useResizeObserver";
    import { useVirtualGrid } from "../../shared/utils/useVirtualGrid";

    export let selectedCategory: string;
    export let selectedSubcategory: string | null = null;
    export let selectedProductType: string | null = null;
    export let products: any[] = [];

    // No longer need DataManager context - using direct store import
    const dispatch = createEventDispatcher();

    let productsGridRef: HTMLElement;
    let parentScrollContainer: HTMLElement | null = null;

    // Sort and filter state
    let sortDropdownOpen = false;
    let brandsDropdownOpen = false;
    let organicDropdownOpen = false;

    // === BUSINESS LOGIC (Keeps Svelte reactivity) ===

    // Simple inline logic for sort controls visibility
    $: {
        const categoryConfig = mainCategories.find(c => c.name === selectedCategory);
        const subcategoryConfig = categoryConfig?.subcategories.find(s => s.name === (selectedSubcategory || ""));
        const isGridOnly = subcategoryConfig?.gridOnly === true;
        const isSpecificProductType = selectedProductType && selectedProductType !== "All" && subcategoryConfig?.productTypes?.includes(selectedProductType);
        shouldShowControls = isGridOnly || !!isSpecificProductType;
    }
    
    let shouldShowControls = false;

    // Extract unique brands from products
    $: availableBrands = (() => {
        const brands = new Set<string>();
        products.forEach((product: any) => {
            if (product.brand && product.brand.trim()) {
                brands.add(product.brand.trim());
            }
        });
        return Array.from(brands).sort();
    })();

    // Track previous sort/filter state to detect order changes
    let previousSortState = {
        sortBy: $filterState?.sortBy || 'best',
        brands: new Set($filterState?.selectedBrands || []),
        organic: $filterState?.selectedOrganic || 'all',
    };

    // Apply sorting and filtering to products using DataManager
    $: sortedFilteredProducts = (() => {
        const filtered = getSortedFilteredProducts(products, $filterState.sortBy, $filterState.selectedBrands, $filterState.selectedOrganic);

        // Detect if array order changed (not just data changes)
        const currentSortState = {
            sortBy: $filterState.sortBy,
            brands: new Set($filterState.selectedBrands),
            organic: $filterState.selectedOrganic,
        };

        const orderChanged =
            currentSortState.sortBy !== previousSortState.sortBy ||
            currentSortState.organic !== previousSortState.organic ||
            currentSortState.brands.size !== previousSortState.brands.size ||
            !Array.from(currentSortState.brands).every((brand) =>
                previousSortState.brands.has(brand),
            );

        if (orderChanged && virtualGrid) {
            // Reset virtual grid elements when order changes
            virtualGrid.resetElements();
        }

        previousSortState = currentSortState;
        return filtered;
    })();

    // === DIRECT CSS POSITIONING (Vanilla JS performance) ===

    // Local state for container sizing only
    let totalHeight: number = 0;

    // Simplified callbacks - only for business data changes, not positioning
    const virtualGridCallbacks = {
        onTotalHeightChange: (height: number) => {
            totalHeight = height;
        },
        onItemsChange: () => {
            // Trigger element rescan after DOM updates
            setTimeout(() => {
                if (virtualGrid) {
                    virtualGrid.scanForElements();
                }
            }, 50);
        },
    };

    // Initialize virtual grid with simplified callback approach
    const virtualGrid = useVirtualGrid(
        {
            items: [],
            itemWidth: 245,
            itemHeight: 450,
        },
        virtualGridCallbacks,
    );

    // Use resize observer for scroll container changes
    const scrollContainerResizeObserver = useResizeObserver(
        async () => {
            if (virtualGrid && sortedFilteredProducts.length > 0) {
                virtualGrid.updateItems(sortedFilteredProducts);
            }
        },
        {
            debounceMs: 50,
            requiresTick: true,
        },
    );

    // Update virtual grid when BUSINESS DATA changes (stay reactive)
    $: if (virtualGrid && sortedFilteredProducts) {
        virtualGrid.updateItems(sortedFilteredProducts);
    }

    // Event handlers for dropdowns
    function handleSortChange(event: CustomEvent<any>) {
        setSortBy(event.detail);
        sortDropdownOpen = false;
    }

    function handleBrandsChange(event: CustomEvent<any>) {
        setSelectedBrands(event.detail);
        brandsDropdownOpen = false;
    }

    function handleOrganicChange(event: CustomEvent<any>) {
        setSelectedOrganic(event.detail);
        organicDropdownOpen = false;
    }

    function handleSortOpen() {
        brandsDropdownOpen = false;
        organicDropdownOpen = false;
    }

    function handleBrandsOpen() {
        sortDropdownOpen = false;
        organicDropdownOpen = false;
    }

    function handleOrganicOpen() {
        sortDropdownOpen = false;
        brandsDropdownOpen = false;
    }

    $: gridId = selectedProductType
        ? `all-products-${selectedProductType}`
        : `all-products-${selectedCategory}`;

    $: title =
        selectedProductType !== "All"
            ? selectedProductType
            : selectedSubcategory || "All Products";

    onMount(() => {
        // Find the global scroll container for resize observation
        const scrollContainer = document.querySelector(
            ".global-scroll-container",
        ) as HTMLElement | null;

        parentScrollContainer = scrollContainer;

        if (parentScrollContainer) {
            scrollContainerResizeObserver.observe(parentScrollContainer);
        } else {
            console.error(
                "Global scroll container not found! ResizeObserver for scrollbar changes will not be active.",
            );
        }

        return () => {
            scrollContainerResizeObserver.disconnect();
        };
    });

    onDestroy(() => {
        scrollContainerResizeObserver.disconnect();
    });
</script>

<div class="all-products-grid" id={gridId}>
    {#if title}
        <div class="section-header">
            <div class="all-products-title">
                <b>{title}</b>
            </div>
            {#if shouldShowControls}
                <div class="sort-filter-controls">
                    <SortFilterDropdown
                        type="sort"
                        currentSort={$filterState.sortBy}
                        bind:isOpen={sortDropdownOpen}
                        on:sortChange={handleSortChange}
                        on:open={handleSortOpen}
                    />
                    <SortFilterDropdown
                        type="brands"
                        selectedBrands={$filterState.selectedBrands}
                        {availableBrands}
                        bind:isOpen={brandsDropdownOpen}
                        on:brandsChange={handleBrandsChange}
                        on:open={handleBrandsOpen}
                    />
                    <SortFilterDropdown
                        type="organic"
                        selectedOrganic={$filterState.selectedOrganic}
                        bind:isOpen={organicDropdownOpen}
                        on:organicChange={handleOrganicChange}
                        on:open={handleOrganicOpen}
                    />
                </div>
            {/if}
        </div>
    {/if}
    <div
        class="products-grid"
        bind:this={productsGridRef}
        use:virtualGrid.action
    >
        {#if sortedFilteredProducts.length > 0}
            <!-- Fixed height container for virtual scrolling -->
            <div class="grid-container" style="height: {totalHeight}px;">
                <!-- Render ALL products with virtual index attributes -->
                <!-- useVirtualGrid will handle show/hide and positioning via direct CSS transforms -->
                {#each sortedFilteredProducts as product, index (product.hash || index)}
                    <div
                        class="product-container"
                        data-virtual-index={index}
                        style="display: none; position: absolute; width: 245px; height: 450px;"
                    >
                        <ProductCard
                            {product}
                            on:reportCategory={(event) =>
                                dispatch("reportCategory", event.detail)}
                            on:productTypeSelect
                        />
                    </div>
                {/each}
            </div>
        {:else}
            <div class="loading-message">No products found</div>
        {/if}
    </div>
</div>

<style>
    .all-products-grid {
        padding-top: 20px;
        padding-bottom: 20px;
        width: 100%;
        box-sizing: border-box;
    }

    .all-products-title {
        font-size: 30px;
        font-weight: bold;
        text-align: left;
        margin-bottom: 0px;
        color: #343538;
    }

    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        margin-bottom: 20px;
        position: relative;
    }

    .sort-filter-controls {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
    }

    .products-grid {
        width: 100%;
        position: relative;
        box-sizing: border-box;
        overflow: visible;
        max-width: 100%;
        /* Remove debug border */
        /* border: 1px solid rgb(247, 0, 255); */
    }

    .grid-container {
        position: relative;
        width: 100%;
        overflow: visible;
        transform: translateZ(0);
        will-change: contents;
        backface-visibility: hidden;
        /* Remove strict containment that can cause clipping */
        /* contain: strict; */
        contain: layout style;
        perspective: 1000px;
        box-sizing: border-box;
        max-width: 100%;
        /* Remove debug border */
        /* border: 2px solid rgb(47, 0, 255); */
    }

    .product-container {
        /* Positioning will be handled by useVirtualGrid via direct CSS transforms */
        /* Initial styles - will be overridden by virtual grid */
        height: 450px;
        width: 245px;
        padding: 0;
        transform: translateZ(0);
        will-change: transform;
        box-sizing: border-box;
        overflow: visible;
    }

    .loading-message {
        padding: 20px;
        text-align: center;
        width: 100%;
        box-sizing: border-box;
    }

    :global(*) {
        outline: none !important;
    }
</style>