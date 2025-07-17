<script lang="ts">
  import { mainCategories } from "../../products/utils/categoryData";

  // Import NavigationStore for simple navigation
  import { navigationStore } from "../../stores/NavigationStore";
  
  // Import clickable action
  import { clickable } from "../../shared/actions/clickable";



  let sidebarElement: HTMLElement;
  let headerElement: HTMLElement;

  // Get current navigation state values
  $: selectedCategory = $navigationStore.category;
  $: selectedSubcategory = $navigationStore.subcategory;

  function selectCategory(category: string) {
    navigationStore.navigate(category);
  }

  function selectSubcategory(subcategory: string) {
    navigationStore.navigate($navigationStore.category, subcategory);
  }

  function goToHome() {
    navigationStore.navigate();
  }
</script>

<div class="sidebar" bind:this={sidebarElement}>
  <div class="sidebar-header" bind:this={headerElement}>
    <div
      class="store-logo-container btn btn-toggle active"
      use:clickable={goToHome}
    >
      <div class="store-name">Ralphs Store</div>
    </div>
  </div>

  <div class="categories-container">
    {#each mainCategories as category}
      <div
        class="category-item btn btn-toggle {selectedCategory === category.name
          ? 'active'
          : ''}"
        use:clickable={() => selectCategory(category.name)}
      >
        {category.name}
      </div>

      {#if selectedCategory === category.name}
        {#each category.subcategories as subcategory (subcategory.name)}
          <div
            class="subcategory-item btn btn-toggle {selectedSubcategory ===
            subcategory.name
              ? 'active'
              : ''}"
            use:clickable={{ handler: () => selectSubcategory(subcategory.name), stopPropagation: true }}
          >
            {subcategory.name}
          </div>
        {/each}
      {/if}
    {/each}
  </div>
</div>

<style>
  .sidebar {
    width: var(--sidebar-width-category);
    height: calc(100vh - var(--component-header-height));
    border-right: var(--border-width-thin) solid var(--border);
    background: var(--background);
    padding: 0;
    overflow-y: auto;
    position: fixed;
    left: 0;
    top: var(--component-header-height);
    box-sizing: border-box;
    -webkit-overflow-scrolling: touch;
    z-index: 5; /* Lower than header's z-index */
  }

  .sidebar-header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--background);
    min-height: var(--component-header-height);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding-left: var(--spacing-xs);
    padding-right: var(--spacing-xs);
  }

  .store-logo-container,
  .category-item,
  .subcategory-item {
    min-height: var(--btn-height-md);
    height: auto;
    font-size: var(--font-size-md);
    display: flex;
    align-items: center;
    text-align: left;
    justify-content: flex-start;
    box-sizing: border-box;
    border-radius: var(--btn-border-radius);
  }

  .store-logo-container {
    padding: var(--btn-padding-md);
    margin: var(--spacing-xs);
    width: calc(100% - (2 * var(--spacing-xs)));
    font-weight: var(--font-weight-bold);
    border: none;
    box-shadow: var(--shadow-button);
  }

  .store-logo-container:hover {
    background: linear-gradient(135deg, var(--primary-dark), var(--secondary));
    transform: translateY(var(--hover-lift));
    box-shadow: var(--shadow-medium);
    border: none;
  }

  .store-name {
    color: var(--button-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .categories-container {
    padding-top: var(--spacing-xs);
    padding-bottom: var(--spacing-md);
    padding-left: var(--spacing-xs);
    padding-right: var(--spacing-xs);
  }

  .category-item {
    padding: var(--btn-padding-md);
    margin-top: var(--spacing-xs);
    margin-bottom: var(--spacing-xs);
    margin-left: var(--spacing-xs);
    margin-right: var(--spacing-xs);
    width: calc(100% - (2 * var(--spacing-xs)));
    box-sizing: border-box;
  }

  .categories-container > .category-item:first-child {
    margin-top: 0;
  }

  .subcategory-item {
    padding: var(--btn-padding-md);
    margin-top: 2px;
    margin-bottom: 2px;
    margin-left: var(--spacing-lg);
    margin-right: var(--spacing-xs);
    width: calc(100% - var(--spacing-lg) - var(--spacing-xs));
    font-weight: normal;
    color: var(--text-secondary);
    white-space: normal;
    line-height: 1.4;
    word-break: break-word;
    box-sizing: border-box;
    position: relative;
  }

  /* Circle aligned with category items */
  .subcategory-item::before {
    content: "";
    position: absolute;
    left: calc(-1 * var(--spacing-lg) + var(--spacing-xs));
    top: 50%;
    width: 8px;
    height: 8px;
    background-color: var(--primary);
    border-radius: 50%;
    transform: translateY(-50%);
  }

  .category-item.active,
  .subcategory-item.active {
    border: none;
    font-weight: var(--font-weight-bold);
    color: var(--button-text);
    box-shadow: var(--shadow-button);
  }

  .subcategory-item.active {
    font-weight: var(--font-weight-semibold);
  }

  .subcategory-item.active::before {
    background-color: var(--primary);
  }

  .category-item.active:hover,
  .subcategory-item.active:hover {
    background: linear-gradient(135deg, var(--primary-dark), var(--secondary));
    transform: translateY(var(--hover-lift));
    box-shadow: var(--shadow-medium);
    border: none;
  }

  /* Ensure active subcategory keeps primary color on hover */
  .subcategory-item.active:hover::before {
    background-color: var(--primary);
  }
</style>
