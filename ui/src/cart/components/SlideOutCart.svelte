<script lang="ts">
  import { onMount } from "svelte";
  import { Frown } from "lucide-svelte";
  import { cartItems, cartTotal, cartPromoTotal, clearCart as clearCartService, isCheckoutSession } from "../services/CartBusinessService";
  import CartHeader from "./CartHeader.svelte";
  import UnifiedCartItem from "./UnifiedCartItem.svelte";
  import CheckoutFlow from "./checkout/CheckoutFlow.svelte";
  import { calculateSavings, formatTotal, formatSavings } from "../../utils/priceUtils";
  import { clickable } from "../../shared/actions/clickable";
  import { stopCartZipper, getAnimationDuration, startCartZipper } from "../../utils/animationUtils";

  // Props
  export let isOpen = false;
  export let onClose = () => {};

  // Reset animation flag when cart opens
  $: if (isOpen) {
    hasTriggeredInitialZipper = false;
  }

  // Cart service is now store-based, no context needed


  // DELETED: ProductDataService no longer needed with new CartItem structure

  // State  
  let enrichedCartItems: any[] = [];
  let isLoading = true;
  let isShowingCheckoutFlow = false;
  let checkoutError = "";
  let isClosing = false;
  let isTransitioningToCheckout = false;
  // Use cart totals directly from stores

  // Animation
  let cartContainer: HTMLElement;
  let hasTriggeredInitialZipper = false;


  // DELETED: getItemKey function no longer needed

  // SIMPLIFIED: No enrichment needed - CartItems already contain all product data
  function updateEnrichedItems(newCartItems: any[]) {
    // With the new CartItem structure, all product data is already included
    // No need for complex enrichment or fetching
    enrichedCartItems = newCartItems.map(item => ({
      ...item,
      // For backward compatibility with UI components that expect productDetails
      productDetails: {
        name: item.productName,
        price: item.priceAtCheckout,
        image_url: item.productImageUrl
      }
    }));
    
    isLoading = false;
  }

  // Reactive cart items handling
  $: updateEnrichedItems($cartItems || []);

  // Reactive session status - no need for manual checks

  // DELETED: fetchProductDetails function - no longer needed with new CartItem structure

  // Clear cart
  async function clearCart() {
    try {
      await clearCartService();
      closeCart();
    } catch (error) {
      console.error("Error clearing cart:", error);
    }
  }
  // Close cart with animation
  function closeCart() {
    isClosing = true;
    if (cartContainer) stopCartZipper(cartContainer);

    // Wait for animation to complete, then close
    setTimeout(() => {
      onClose();
      isClosing = false;
    }, getAnimationDuration("smooth"));
  }

  // Start checkout flow
  function startCheckout() {
    isTransitioningToCheckout = true;
    if (cartContainer) stopCartZipper(cartContainer);

    setTimeout(() => {
      isShowingCheckoutFlow = true;
      isTransitioningToCheckout = false;
    }, getAnimationDuration("smooth"));
  }

  // Handle checkout success
  function handleCheckoutSuccess() {
    // Cart is now in "Checkout" status - session status will be updated reactively
    closeCart();
  }

  // Close checkout flow - simple switch back to cart
  function closeCheckoutFlow() {
    // Simple immediate switch - CheckoutFlow handles its own exit animation
    isShowingCheckoutFlow = false;
    // Reset flag so zipper animation can trigger when returning to cart
    hasTriggeredInitialZipper = false;
  }


  // Use PriceService for savings calculation
  $: totalSavings = calculateSavings($cartTotal, $cartPromoTotal);

  // Trigger zipper animation ONLY on initial cart load
  $: if (!isLoading && enrichedCartItems.length > 0 && cartContainer && !hasTriggeredInitialZipper) {
    startCartZipper(cartContainer);
    hasTriggeredInitialZipper = true;
    
    // Remove the animation class after it completes to prevent re-animation on DOM changes
    setTimeout(() => {
      if (cartContainer) {
        cartContainer.classList.remove('zipper-enter');
      }
    }, getAnimationDuration('smooth'));
  }
</script>

{#if isOpen}
  <div
    class="overlay {isClosing ? 'fade-out pointer-events-none' : 'fade-in'}"
    use:clickable={closeCart}
  >
    <div
      class="cart-container {isClosing ? 'slide-out-right' : 'slide-in-right'}"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cart-title"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      {#if isShowingCheckoutFlow}
        <CheckoutFlow
          cartItems={enrichedCartItems}
          onClose={closeCheckoutFlow}
          isClosingCart={isClosing}
          on:checkout-success={handleCheckoutSuccess}
        />
      {:else}
        <CartHeader
          onClose={closeCart}
          isClosing={isClosing || isTransitioningToCheckout}
        />

        <div class="cart-content">
          <div class="cart-main">
            <div class="cart-main-header">
              <div
                class="cart-title {isClosing
                  ? 'slide-out-left'
                  : isTransitioningToCheckout
                    ? 'slide-out-left'
                    : 'slide-in-left'}"
                id="cart-title"
              >
                Cart ({$isCheckoutSession ? 0 : enrichedCartItems.length} item{($isCheckoutSession ? 0 : enrichedCartItems.length) !== 1
                  ? "s"
                  : ""})
              </div>
              <div
                class="clear-cart-btn-wrapper {isClosing
                  ? 'slide-out-right'
                  : isTransitioningToCheckout
                    ? 'slide-out-right'
                    : 'slide-in-right'}"
              >
                <button
                  class="clear-cart-btn btn btn-text"
                  on:click={clearCart}
                >
                  Clear this cart
                </button>
              </div>
            </div>

            <!-- UPDATED: Price display using PriceService -->
            <div
              class="cart-totals-section {isClosing
                ? 'slide-out-left'
                : isTransitioningToCheckout
                  ? 'slide-out-left'
                  : 'slide-in-left'}"
            >
              <div class="cart-total-regular">
                Total: {formatTotal($isCheckoutSession ? 0 : $cartTotal)}
              </div>
              <div class="cart-total-promo">
                With loyalty card: {formatTotal($isCheckoutSession ? 0 : $cartPromoTotal)}
              </div>
              {#if !$isCheckoutSession && totalSavings > 0}
                <div class="savings-amount">
                  You save: {formatSavings(totalSavings)}
                </div>
              {/if}
            </div>

            <div class="cart-items" bind:this={cartContainer}>
              {#if isLoading}
                <div class="loading">Loading cart items...</div>
              {:else if $isCheckoutSession || enrichedCartItems.length === 0}
                <div class="empty-cart">
                  <Frown size={48} class="empty-cart-icon" />
                  <span class="empty-cart-text">{$isCheckoutSession ? "Cart is checked out" : "Your cart is empty"}</span>
                </div>
              {:else}
                {#each [...enrichedCartItems].sort((a, b) => (a.addedOrder || 0) - (b.addedOrder || 0)) as item (item.productId)}
                  <UnifiedCartItem
                    cartItem={item}
                    variant="cart"
                  />
                {/each}
              {/if}

              {#if checkoutError}
                <div class="error-message">
                  {checkoutError}
                </div>
              {/if}
            </div>

            <div class="checkout-button-container {isClosing
              ? 'slide-out-down'
              : isTransitioningToCheckout
                ? 'slide-out-down'
                : 'slide-in-up'}">
              <button
                class="checkout-button btn btn-primary btn-lg"
                disabled={$isCheckoutSession || enrichedCartItems.length === 0}
                on:click={startCheckout}
              >
                {$isCheckoutSession ? "Order Checked Out" : "Proceed to Checkout"}
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: var(--overlay-dark);
    z-index: var(--z-index-highest);
  }

  .overlay.fade-in {
    animation: fadeIn var(--transition-smooth) ease-out forwards;
  }

  .overlay.fade-out {
    animation: fadeOut var(--transition-smooth) ease-in forwards;
  }

  .cart-container {
    position: fixed;
    top: 0;
    right: 0;
    width: 480px;
    height: 100vh;
    background: var(--background);
    box-shadow: var(--shadow-sidebar);
    display: flex;
    flex-direction: column;
    z-index: var(--z-index-highest);
    overflow: hidden;
  }

  .cart-container.slide-in-right {
    animation: slideInRight var(--transition-normal) ease-out forwards;
  }

  .cart-container.slide-out-right {
    animation: slideOutRight var(--transition-normal) ease-in forwards;
  }

  .cart-content {
    flex: 1;
    overflow: hidden;
    padding: 0;
  }

  .cart-main {
    position: relative;
    border: none;
    margin: 0;
    padding: 0;
    background-color: var(--background);
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .cart-main-header {
    height: var(--component-header-height);
    min-height: var(--component-header-height);
    box-sizing: border-box;
    padding: 0 var(--spacing-lg);
    position: sticky;
    top: 0;
    background: var(--background);
    z-index: var(--z-index-sticky);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: var(--border-width-thin) solid var(--border);
  }

  .cart-title {
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .cart-totals-section {
    padding: var(--spacing-sm) var(--spacing-lg);
    background: linear-gradient(
      135deg,
      rgba(86, 98, 189, 0.05),
      rgba(112, 70, 168, 0.05)
    );
    border-bottom: var(--border-width-thin) solid var(--border);
  }

  .cart-total-regular {
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .cart-total-promo {
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    color: var(--primary);
  }

  .savings-amount {
    font-size: var(--font-size-sm);
    color: var(--success);
    font-weight: var(--font-weight-semibold);
    margin-top: 4px;
  }

  .clear-cart-btn {
    color: var(--error);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    padding: var(--spacing-xs) var(--spacing-sm);
  }

  .clear-cart-btn:hover {
    background-color: rgba(211, 47, 47, 0.1);
    color: var(--error);
    text-decoration: underline;
  }

  .cart-items {
    flex: 1 1 auto;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--spacing-sm) var(--spacing-lg) 0 var(--spacing-lg);
    min-height: 0;
  }

  .error-message {
    margin: var(--spacing-md) 0;
    padding: var(--spacing-sm);
    background-color: rgba(211, 47, 47, 0.1);
    color: var(--error);
    border-radius: var(--card-border-radius);
    font-size: var(--font-size-sm);
  }

  .empty-cart {
    padding: var(--spacing-xxl) 0;
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-md);
  }

  .empty-cart :global(.empty-cart-icon) {
    color: var(--text-secondary);
    opacity: 0.6;
  }

  .empty-cart-text {
    font-size: var(--font-size-md);
    color: var(--text-secondary);
  }

  .loading {
    padding: var(--spacing-xxl) 0;
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
  }

  .checkout-button-container {
    padding: var(--spacing-lg);
    background: var(--background);
    border-top: var(--border-width-thin) solid var(--border);
    margin-top: calc(-1 * var(--border-width-thin));
  }

  .checkout-button {
    width: 100%;
  }

  .checkout-button[disabled] {
    background: var(--surface);
    border: var(--border-width-thin) solid var(--border);
    color: var(--text-secondary);
    cursor: not-allowed;
    opacity: 0.7;
    box-shadow: none;
    transform: none;
  }

  .pointer-events-none {
    pointer-events: none;
  }
</style>
