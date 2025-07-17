<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { cartTotal, uniqueItemCount, isCheckoutSession } from "../../cart/services/CartBusinessService";
  import { ShoppingCart, Menu } from "lucide-svelte";
  import SearchBar from "../../search/SearchBar.svelte";
  import SidebarMenu from "./SidebarMenu.svelte";

  // Import from UI-only store
  import {
    currentViewStore,
    isCartOpenStore,
    productNameStore,
    selectedProductHashStore,
    searchResultsStore,
    isViewAllStore,
    showMenuStore,
    searchMethodStore,
  } from "../../stores/UiOnlyStore";

  // Import NavigationStore for search functionality
  import { navigationStore } from "../../stores/NavigationStore";

  // Cart service is now store-based, no context needed


  // These now come from the UiStateStore
  export let cartTotalValue = 0; // This prop is passed from Controller, but we'll use the cart service value


  // Direct reactive access to cart stores
  $: cartTotalValue = $cartTotal;
  $: uniqueItemCountValue = $uniqueItemCount;
  
  // Show zero values when in checkout session
  $: displayTotalValue = $isCheckoutSession ? 0 : cartTotalValue;
  $: displayItemCount = $isCheckoutSession ? 0 : uniqueItemCountValue;



  function toggleCart() {
    $isCartOpenStore = !$isCartOpenStore;
  }

  function toggleMenu() {
    $showMenuStore = !$showMenuStore;
  }
</script>

<div class="header-container">
  <div class="left-section">
    <!-- Hamburger menu button -->
    <button
      class="menu-button btn btn-icon btn-icon-primary"
      on:click={toggleMenu}
      title="Menu"
    >
      <Menu size={24} color="white" />
    </button>

    <!-- Logo text -->
    <span class="app-logo">SUMN.</span>
  </div>

  <div class="center-section">
    <div class="search-container">
      <SearchBar
        on:select={({ detail }) => {
          // Enter search mode and set UI-only search result data
          navigationStore.search(detail.originalQuery);
          $productNameStore = detail.productName;
          $selectedProductHashStore = detail.hash;
          $searchResultsStore = detail.fuseResults || [];
          $isViewAllStore = false;
          $searchMethodStore = "product_selection";
        }}
        on:viewAll={({ detail }) => {
          // Enter search mode and set UI-only search result data
          navigationStore.search(detail.query);
          $searchResultsStore = detail.fuseResults || [];
          $isViewAllStore = detail.isViewAll || false;
          $selectedProductHashStore = null;
          $productNameStore = "";
          $searchMethodStore = detail.searchMethod || "";
        }}
      />
    </div>
  </div>

  <div class="right-section">
    <!-- View toggle button -->
    <button
      class="view-toggle btn btn-secondary btn-md"
      on:click={() => {
        $currentViewStore =
          $currentViewStore === "active" ? "checked-out" : "active";
      }}
    >
      {$currentViewStore === "active"
        ? "View Checked Out Carts"
        : "Go Back To Store"}
    </button>

    <button
      class="cart-button btn btn-primary btn-md"
      on:click={toggleCart}
      title="Shopping Cart"
    >
      <span class="item-count">{displayItemCount}</span>
      <ShoppingCart size={30} color="#ffffff" />
      <span class="cart-total">${displayTotalValue.toFixed(2)}</span>
    </button>
  </div>
</div>

<style>
  .header-container {
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    height: var(--component-header-height);
    background: var(--background);
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: var(--shadow-subtle);
    z-index: var(--z-index-modal);
    padding-left: var(--sidebar-width-category);
  }

  .left-section {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    width: var(--sidebar-width-category);
    position: absolute;
    left: 0;
    padding-left: var(--spacing-md);
    box-sizing: border-box;
  }

  .menu-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--btn-height-md);
    height: var(--btn-height-md);
  }

  .app-logo {
    font-size: var(--font-size-xl, 35px);
    font-weight: var(--font-weight-bold, 700);
    color: var(--text-primary, #ffffff);
    padding-left: var(--spacing-xs);
  }

  .view-toggle,
  .cart-button {
    width: 235px;
    height: var(--btn-height-md);
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    white-space: nowrap;
    box-sizing: border-box;
    padding: 0;
  }

  .view-toggle {
    justify-content: center;
    padding: 0 var(--spacing-sm);
  }

  .cart-button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .center-section {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    flex: 1;
    justify-content: flex-start;
    padding-left: var(--spacing-md);
    padding-right: var(--spacing-md);
  }

  .right-section {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding-right: var(--spacing-md);
  }

  .search-container {
    flex: 1;
    height: var(--btn-height-md);
    width: 100%;
    max-width: 100%;
  }

  .search-container :global(input) {
    border-radius: var(--btn-border-radius) !important;
    height: var(--btn-height-md) !important;
    font-size: var(--font-size-md) !important;
    border: var(--border-width-thin) solid var(--border) !important;
    transition: var(--btn-transition) !important;
    box-sizing: border-box !important;
  }

  .search-container :global(input:focus) {
    border-color: var(--primary) !important;
    box-shadow: var(--shadow-subtle) !important;
  }

  .item-count {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--btn-icon-size-sm);
    height: var(--btn-icon-size-sm);
    min-width: var(--btn-icon-size-sm);
    background-color: rgba(0, 0, 0, 0.15);
    color: var(--button-text);
    border-radius: 50%;
    font-size: var(--font-size-md);
    position: absolute;
    left: calc(50% - 100px);
  }

  .cart-total {
    font-size: var(--font-size-md);
    color: var(--button-text);
    white-space: nowrap;
    position: absolute;
    right: calc(50% - 100px);
  }
</style>
