<script lang="ts">
  import { getContext } from "svelte";
  import SearchResults from "../../search/SearchResults.svelte";
  import ReportCategoryDialog from "../../reports/components/ReportCategoryDialog.svelte";
  import ProductBrowserData from "../../products/components/ProductBrowserData.svelte";

  // Import from UI-only store
  import {
    currentViewStore,
    showReportDialogStore,
    reportedProductStore,
    productNameStore,
    selectedProductHashStore,
    searchResultsStore,
    isViewAllStore,
    searchMethodStore,
    featuredSubcategories,
  } from "../../stores/UiOnlyStore";

  // Import from data trigger store (keeping sort/filter stores for now)
  // Note: searchMode and searchQuery now come from DataManager navigationState

  // No longer need DataManager context - using direct imports

  // Import NavigationStore and category utilities
  import { navigationStore } from "../../stores/NavigationStore";
  import { mainCategories } from "../../products/utils/categoryData";

  // Store context removed - using direct service access

  export function selectCategory(category: any, subcategory: any) {
    handleCategorySelect({ detail: { category, subcategory } });
  }

  // UIProps removed - using direct store access

  function handleCategorySelect({
    detail: { category, subcategory },
  }: {
    detail: { category: any; subcategory: any };
  }) {
    navigationStore.navigate(category, subcategory);
  }

  async function handleReportSubmit(event: CustomEvent) {
    try {
      const response = await fetch(
        "http://localhost:3000/api/report-category",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event.detail),
        },
      );

      if (response.ok) {
        alert("Thank you for your feedback!");
        $showReportDialogStore = false;
      } else {
        throw new Error(`Server responded with ${response.status}`);
      }
    } catch (error) {
      console.error("Error submitting report:", error);
      alert(
        "There was an error submitting your report. Please try again later.",
      );
    }
  }

  // Simple inline logic for product type navigation visibility
  $: {
    const category = $navigationStore.category || "";
    const subcategory = $navigationStore.subcategory || "";
    const categoryConfig = mainCategories.find((c) => c.name === category);
    const subcategoryConfig = categoryConfig?.subcategories.find(
      (s) => s.name === subcategory,
    );
    showProductTypeNavigation = !!(
      subcategoryConfig?.productTypes &&
      subcategoryConfig.productTypes.length > 1 &&
      !subcategoryConfig.gridOnly
    );
    filteredProductTypes =
      subcategoryConfig?.productTypes?.filter((pt) => pt !== "All") || [];
  }

  let showProductTypeNavigation = false;
  let filteredProductTypes: string[] = [];
</script>

<div class="root-container" class:no-sidebar={$currentViewStore !== "active"}>
  <div class="main-content">
    <div class="content-wrapper">
      {#if $navigationStore.category && $navigationStore.subcategory && !$navigationStore.searchMode}
        {#if showProductTypeNavigation}
          <div class="product-type-nav">
            <div class="product-type-container">
              <button
                class="product-type-btn btn btn-toggle {($navigationStore.productType ||
                  'All') === 'All'
                  ? 'active'
                  : ''}"
                on:click={() =>
                  navigationStore.navigate(
                    $navigationStore.category,
                    $navigationStore.subcategory,
                    null,
                  )}
              >
                All
              </button>
              {#each filteredProductTypes as productType}
                <button
                  class="product-type-btn btn btn-toggle {$navigationStore.productType ===
                  productType
                    ? 'active'
                    : ''}"
                  on:click={() =>
                    navigationStore.navigate(
                      $navigationStore.category,
                      $navigationStore.subcategory,
                      productType,
                    )}
                >
                  {productType}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      {/if}

      <div class="product-sections">
        {#if $navigationStore.searchMode}
          <SearchResults
            query={$navigationStore.searchQuery}
            selectedProductHash={$selectedProductHashStore}
            productName={$productNameStore}
            searchResults={$searchResultsStore}
            searchMethod={$searchMethodStore}
            on:reportCategory={(event) => {
              $reportedProductStore = event.detail;
              $showReportDialogStore = true;
            }}
            on:productTypeSelect={(event) => {
              const { productType, category, subcategory } = event.detail;
              navigationStore.navigate(category, subcategory, productType);
            }}
          />
        {:else}
          <ProductBrowserData
            {featuredSubcategories}
            on:reportCategory={(event) => {
              $reportedProductStore = event.detail;
              $showReportDialogStore = true;
            }}
          />
        {/if}
      </div>
    </div>
  </div>
</div>
{#if $reportedProductStore && $showReportDialogStore}
  <ReportCategoryDialog
    bind:isOpen={$showReportDialogStore}
    product={$reportedProductStore}
    on:submit={handleReportSubmit}
  />
{/if}

<style>
  .product-sections {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xxxl);
    overflow: visible;
    padding: 0;
    width: 100%;
  }

  :global(hr) {
    opacity: 0.4;
  }

  :global(.attachment-button) {
    width: var(--btn-icon-size-sm);
    height: var(--btn-icon-size-sm);
    padding: 4px;
    border-radius: 50%;
    border: var(--border-width-thin) solid var(--border);
    background-color: var(--overlay-button);
    box-shadow: var(--shadow-button);
  }
  :global(.attachment-button:hover) {
    transform: scale(var(--hover-scale-button));
  }

  :global(.attachment-group:active) {
    border-color: var(--primary-dark);
    background-color: var(--primary);
    box-shadow: var(--shadow-button);
    border-bottom: var(--border-width) solid var(--primary-dark);
  }

  .root-container {
    display: flex;
    height: 100%;
    width: calc(100% - var(--sidebar-width-category));
    margin: 0 0 0 var(--sidebar-width-category);
    position: relative;
    box-sizing: border-box;
    padding-right: 0;
    right: 0;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: visible;
    max-width: 100%;
  }

  .content-wrapper {
    padding-left: var(--spacing-md);
    padding-right: var(--spacing-md);
    box-sizing: border-box;
  }

  .product-type-nav {
    position: sticky;
    top: var(--component-header-height);
    z-index: 200;
    background: var(--background);
    min-height: var(--component-header-height);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    padding-top: var(--spacing-md);
    padding-bottom: var(--spacing-md);
    padding-left: 0;
    padding-right: 0;
    margin-left: calc(-1 * var(--spacing-md));
    margin-right: calc(-1 * var(--spacing-md));
    border-bottom: var(--border-width-thin) solid var(--border-lighter);
  }

  .product-type-container {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
    width: 100%;
    box-sizing: border-box;
    max-width: 100%;
    padding-left: var(--spacing-md);
    padding-right: var(--spacing-md);
  }

  .product-type-btn {
    white-space: nowrap;
    height: var(--btn-height-sm);
  }

  .root-container.no-sidebar {
    width: calc(100% - var(--content-margin) * 2);
    margin: 0 var(--content-margin);
  }
</style>
