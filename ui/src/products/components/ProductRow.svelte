<script lang="ts">
    import NavigationArrows from "../../shared/components/NavigationArrows.svelte";
    import ProductCard from "./ProductCard.svelte";
    import { createEventDispatcher } from "svelte";
    import { ChevronRight } from "lucide-svelte";
    import { navigationStore } from "../../stores/NavigationStore";
    import { clickable } from "../../shared/actions/clickable";

    // Required props
    export let title: string;
    export let identifier: string;
    export let products: any[] = [];
    export let currentRanges: Record<string, any>;
    export let totalProducts: Record<string, any> = {};
    export let selectedCategory: string;
    export let selectedSubcategory: string;
    export let mainGridContainer: HTMLElement;
    export let isProductType = false;
    export let action: any;
    export let hasMore: Record<string, any> = {};
    export let containerCapacity = 4;

    const dispatch = createEventDispatcher();

    function handleViewMore() {
        if (isProductType) {
            navigationStore.navigate(selectedCategory, selectedSubcategory, identifier);
        } else {
            navigationStore.navigate(selectedCategory, selectedSubcategory);
        }
    }

    function handleReportCategory(event: CustomEvent) {
        dispatch("reportCategory", event.detail);
    }
</script>

<div class="product-row" id={identifier} use:action>
    <div class="section-header">
        <div class="product-row-title">
            <b>{title}</b>
        </div>
        <span
            class="view-all-link btn btn-text"
            use:clickable={{ handler: handleViewMore, stopPropagation: true }}
        >
            View More
            <ChevronRight size={20} class="chevron-icon" />
        </span>
    </div>

    <div class="product-row-items" data-subcategory={identifier} use:action>
        <NavigationArrows
            direction="left"
            disabled={currentRanges[identifier]?.start === 0}
            hasMore={hasMore[identifier] ?? true}
            {currentRanges}
            {totalProducts}
            {identifier}
            {selectedCategory}
            {selectedSubcategory}
            {mainGridContainer}
            {containerCapacity}
            {isProductType}
            on:dataLoaded
            on:boundariesInitialized
        />

        {#if products && products.length > 0}
            {#each products as product (product.hash)}
                <ProductCard
                    {product}
                    {selectedCategory}
                    {selectedSubcategory}
                    on:reportCategory={handleReportCategory}
                    on:productTypeSelect
                />
            {/each}
        {/if}

        <NavigationArrows
            direction="right"
            disabled={!products || !hasMore[identifier]}
            hasMore={hasMore[identifier] ?? true}
            {currentRanges}
            {totalProducts}
            {identifier}
            {selectedCategory}
            {selectedSubcategory}
            {mainGridContainer}
            {containerCapacity}
            {isProductType}
            on:dataLoaded
            on:boundariesInitialized
        />
    </div>
</div>

<style>
    .product-row {
        position: relative;
        display: block;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-width: 290px;
        border: none;
        background-color: transparent;
        border-radius: var(--card-border-radius);
        padding-top: var(--spacing-lg);
        padding-bottom: var(--spacing-lg);
        width: 100%;
        margin-bottom: var(--spacing-lg);
        box-sizing: border-box;
        transition: var(--card-transition);
    }

    .product-row-title {
        font-size: 30px;
        font-weight: var(--font-weight-bold);
        text-align: left;
        margin-bottom: 0px;
        color: var(--text-primary);
    }

    .product-row-title b {
        color: var(--text-primary);
    }

    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        width: 100%;
        margin-bottom: var(--spacing-lg);
        position: relative;
    }

    .view-all-link {
        font-size: var(--spacing-lg);
        font-weight: var(--font-weight-bold);
        text-decoration: none;
        cursor: pointer;
        display: flex;
        align-items: center;
    }

    :global(.chevron-icon) {
        transition: transform var(--transition-normal) ease;
    }

    .view-all-link:hover :global(.chevron-icon) {
        transform: translateX(2px);
    }

    .product-row-items {
        display: grid;
        grid-template-columns: repeat(auto-fill, 245px);
        grid-template-rows: 450px;
        gap: 0px;
        width: 100%;
        justify-content: space-between;
        max-height: 450px;
        overflow: visible;
        box-sizing: border-box;
        max-width: 100%;
    }
</style>
