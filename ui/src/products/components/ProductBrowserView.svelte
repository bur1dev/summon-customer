<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import AllProductsGrid from "./AllProductsGrid.svelte";
    import ProductRow from "./ProductRow.svelte";
    import { mainCategories } from "../utils/categoryData";

    // Props passed from data component
    export let isHomeView: boolean;
    export let selectedCategory: string | null;
    export let selectedSubcategory: string | null;
    export let selectedProductType: string;
    export let categoryProducts: Record<string, any[]>;
    export let allCategoryProducts: any[];
    export let currentRanges: Record<string, { start: number; end: number }>;
    export let totalProducts: Record<string, number>;
    export let hasMore: Record<string, boolean>;
    export let containerCapacity: number;
    export let rowCapacities: Record<string, number>;
    export let action: any;
    export let gridContainer: Record<string, any>;
    export let mainGridContainer: HTMLElement;
    export let isLoadingProductType: boolean;

    const dispatch = createEventDispatcher();

    function handleDataLoaded(event: CustomEvent) {
        dispatch("dataLoaded", event.detail);
    }

    function handleBoundariesInitialized(event: CustomEvent) {
        dispatch("boundariesInitialized", event.detail);
    }

    function handleReportCategory(event: CustomEvent) {
        dispatch("reportCategory", event.detail);
    }

    function handleProductTypeSelect(event: CustomEvent) {
        dispatch("productTypeSelect", event.detail);
    }


    function getSubcategoryFromIdentifier(identifier: string): string {
        if (!identifier.includes("_")) return identifier;
        const parts = identifier.split("_");
        return parts[1];
    }

    function getCategoryFromIdentifier(identifier: string): string | null {
        if (!identifier.includes("_")) return selectedCategory;
        const parts = identifier.split("_");
        return parts[0];
    }
</script>

<div class="product-browser" bind:this={mainGridContainer}>
    {#if isHomeView}
        {#each Object.keys(categoryProducts) as identifier}
            {#if categoryProducts[identifier]?.length > 0}
                {@const rowCategory = getCategoryFromIdentifier(identifier)}
                {@const rowSubcategory =
                    getSubcategoryFromIdentifier(identifier)}
                <ProductRow
                    title={rowSubcategory}
                    {identifier}
                    products={categoryProducts[identifier]}
                    {currentRanges}
                    {totalProducts}
                    {hasMore}
                    selectedCategory={rowCategory || ""}
                    selectedSubcategory={rowSubcategory}
                    {mainGridContainer}
                    containerCapacity={rowCapacities[identifier] ||
                        containerCapacity}
                    {action}
                    bind:this={gridContainer[identifier]}
                    on:dataLoaded={handleDataLoaded}
                    on:boundariesInitialized={handleBoundariesInitialized}
                    on:reportCategory={handleReportCategory}
                    on:productTypeSelect={handleProductTypeSelect}
                />
            {/if}
        {/each}
    {:else if selectedCategory && !selectedSubcategory}
        {#each (mainCategories.find(c => c.name === selectedCategory)?.subcategories || []) as subcategory}
            {@const identifier = subcategory.name}
            {#if categoryProducts[identifier]}
                <ProductRow
                    title={identifier}
                    {identifier}
                    products={categoryProducts[identifier]}
                    {currentRanges}
                    {totalProducts}
                    {hasMore}
                    {selectedCategory}
                    selectedSubcategory={identifier}
                    {mainGridContainer}
                    containerCapacity={rowCapacities[identifier] ||
                        containerCapacity}
                    {action}
                    bind:this={gridContainer[identifier]}
                    on:dataLoaded={handleDataLoaded}
                    on:boundariesInitialized={handleBoundariesInitialized}
                    on:reportCategory={handleReportCategory}
                    on:productTypeSelect={handleProductTypeSelect}
                />
            {/if}
        {/each}

        <AllProductsGrid
            {selectedCategory}
            selectedSubcategory={null}
            selectedProductType={"All"}
            products={allCategoryProducts}
            on:reportCategory={handleReportCategory}
            on:productTypeSelect={handleProductTypeSelect}
        />
    {:else if selectedCategory && selectedSubcategory}
        {#if (mainCategories.find(c => c.name === selectedCategory)?.subcategories.find(s => s.name === selectedSubcategory)?.gridOnly === true) || (selectedProductType !== "All" && !isLoadingProductType)}
            <AllProductsGrid
                {selectedCategory}
                {selectedSubcategory}
                {selectedProductType}
                products={allCategoryProducts}
                on:reportCategory={handleReportCategory}
                on:productTypeSelect={handleProductTypeSelect}
            />
        {:else if selectedProductType === "All"}
            {#each (mainCategories.find(c => c.name === selectedCategory)?.subcategories.find(s => s.name === selectedSubcategory)?.productTypes?.filter(pt => pt !== "All") || []) as productType}
                {@const identifier = productType}
                {#if categoryProducts[identifier]}
                    <ProductRow
                        title={identifier}
                        {identifier}
                        products={categoryProducts[identifier]}
                        {currentRanges}
                        {totalProducts}
                        {hasMore}
                        {selectedCategory}
                        {selectedSubcategory}
                        {mainGridContainer}
                        containerCapacity={rowCapacities[identifier] ||
                            containerCapacity}
                        {action}
                        bind:this={gridContainer[identifier]}
                        isProductType={true}
                        on:dataLoaded={handleDataLoaded}
                        on:boundariesInitialized={handleBoundariesInitialized}
                        on:reportCategory={handleReportCategory}
                        on:productTypeSelect={handleProductTypeSelect}
                    />
                {/if}
            {/each}
        {/if}
    {/if}
</div>

<style>
    .product-browser {
        display: flex;
        flex-direction: column;
        gap: var(--section-spacing);
        overflow: visible;
        background-color: white;
    }
</style>
