<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { ShoppingCart, X } from "lucide-svelte";
  import { returnToShopping as returnOrderToShopping } from "../../services/OrdersService";
  import { currentViewStore } from "../../../stores/UiOnlyStore";
  import { cartItems, cartTotal, isCheckoutSession } from "../../services/CartBusinessService";
  import { getSessionData } from "../../services/CheckoutService";
  import OrderCard from "./OrderCard.svelte";
  import { decode } from '@msgpack/msgpack';

  // Helper functions to decode Holochain Records
  function decodeAddress(addressRecord: any): any | null {
    try {
      if (!addressRecord?.entry?.Present?.entry) return null;
      const entryBytes = new Uint8Array(addressRecord.entry.Present.entry);
      return decode(entryBytes) as any;
    } catch (error) {
      console.error('Error decoding address:', error);
      return null;
    }
  }

  function decodeDeliveryTimeSlot(timeSlotRecord: any): any | null {
    try {
      if (!timeSlotRecord?.entry?.Present?.entry) return null;
      const entryBytes = new Uint8Array(timeSlotRecord.entry.Present.entry);
      return decode(entryBytes) as any;
    } catch (error) {
      console.error('Error decoding delivery time slot:', error);
      return null;
    }
  }

  function decodeDeliveryInstructions(instructionsRecord: any): any | null {
    try {
      if (!instructionsRecord?.entry?.Present?.entry) return null;
      const entryBytes = new Uint8Array(instructionsRecord.entry.Present.entry);
      return decode(entryBytes) as any;
    } catch (error) {
      console.error('Error decoding delivery instructions:', error);
      return null;
    }
  }


  // Store context removed - direct service access used

  // State
  let isLoading = true;
  let errorMessage = "";
  let isClosing = false;
  let checkoutOrder: any = null;

  // Reactive: Load checkout order when session status changes to checkout
  $: if ($isCheckoutSession) {
    loadCheckoutOrder().catch((error) => {
      console.error("Error loading checkout order:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      errorMessage = "Failed to load checkout order: " + errorMsg;
      isLoading = false;
    });
  } else {
    // Clear order when not in checkout session
    checkoutOrder = null;
    isLoading = false;
  }

  async function loadCheckoutOrder() {
    try {
      console.log('🔍 OrdersView: Loading checkout order');
      isLoading = true;
      errorMessage = "";

      // Get session data to access delivery details
      const sessionResult = await getSessionData();
      
      if (sessionResult.success) {
        const sessionData = sessionResult.data;
        console.log('🛒 OrdersView: Cart items count:', $cartItems.length);
        console.log('🔍 OrdersView: Session status decoded:', sessionData.session_status_decoded);
        
        // Only create checkout order if status is actually "Checkout"
        if (sessionData.session_status_decoded === 'Checkout') {
          // Decode the delivery data
          const decodedAddress = sessionData.address ? decodeAddress(sessionData.address) : null;
          const decodedTimeSlot = sessionData.delivery_time_slot ? decodeDeliveryTimeSlot(sessionData.delivery_time_slot) : null;
          const decodedInstructions = sessionData.delivery_instructions ? decodeDeliveryInstructions(sessionData.delivery_instructions) : null;
            
          // Format order data to match existing OrderCard component expectations
          checkoutOrder = {
            id: 'current-checkout-order',
            products: $cartItems.map(item => ({
              productId: item.productId,
              productName: item.productName,
              quantity: item.quantity,
              upc: item.upc, // UPC for preference lookups
              details: {
                name: item.productName,
                image_url: item.productImageUrl,
                price: item.priceAtCheckout,
                promo_price: item.promoPrice
              }
            })),
            total: $cartTotal,
            createdAt: new Date().toLocaleString(),
            status: sessionData.session_status_decoded,
            deliveryAddress: decodedAddress,
            deliveryTime: decodedTimeSlot ? {
              date: new Date(decodedTimeSlot.date).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long", 
                day: "numeric",
                year: "numeric"
              }),
              time: decodedTimeSlot.time_slot
            } : null,
            deliveryInstructions: decodedInstructions?.instructions || ''
          };
          
          console.log('🎯 OrdersView: checkoutOrder =', checkoutOrder);
        } else {
          // Status is not "Checkout", clear the order
          checkoutOrder = null;
          console.log('🔄 OrdersView: Session status is not Checkout, clearing order');
        }
      } else {
        console.error("Error getting session data:", sessionResult.message);
        errorMessage = "Error loading checkout order: " + sessionResult.message;
        checkoutOrder = null;
      }

      isLoading = false;
    } catch (error) {
      console.error("Error loading checkout order:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      errorMessage = "Error loading checkout order: " + errorMsg;
      isLoading = false;
      checkoutOrder = null;
    }
  }


  // Function to return order to shopping
  async function returnToShopping() {
    try {
      console.log("Returning order to shopping");

      // Call recall order - this will update session status and trigger reactive logic
      const result = await returnOrderToShopping();

      if (result.success) {
        console.log("Order returned to shopping - session status updated");
        // No need to manually refresh - reactive logic will handle it
      } else {
        console.error("Error returning order to shopping:", result.message);
        errorMessage = "Error returning order to shopping: " + result.message;
      }
    } catch (error) {
      console.error("Error returning order to shopping:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      errorMessage = "Error returning order to shopping: " + errorMsg;
    }
  }

  // Go back to store view
  function goBackToStore() {
    isClosing = true;
    setTimeout(() => {
      $currentViewStore = "active";
      isClosing = false;
    }, 300); // Match animation duration
  }
</script>

<div
  class="checkout-view"
  class:fade-out={isClosing}
  class:fade-in={!isClosing}
>
  <div class="fixed-header">
    <button class="back-button" on:click={goBackToStore}>
      <X size={24} />
    </button>
    <h1>Checked Out Orders</h1>
    <p>View the status of your checked out orders</p>
  </div>

  <div class="scrollable-content">
    {#if isLoading}
      <div class="loading">Loading checked out orders...</div>
    {:else if errorMessage}
      <div class="error-message">{errorMessage}</div>
    {:else if !checkoutOrder}
      <div class="empty-state scale-in">
        <ShoppingCart size={64} color="var(--border)" />
        <h2>No Checked Out Orders</h2>
        <p>Your checked out orders will appear here.</p>
      </div>
    {:else}
      <div class="carts-grid">
        <OrderCard 
          item={checkoutOrder} 
          on:returnToShopping={returnToShopping}
        />
      </div>
    {/if}
  </div>
</div>

<style>
  .checkout-view {
    width: 100%;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    padding: 0;
  }

  .checkout-view.fade-in {
    animation: fadeIn var(--transition-normal) ease forwards;
  }

  .checkout-view.fade-out {
    animation: fadeOut var(--transition-normal) ease forwards;
  }

  .fixed-header {
    padding: var(--spacing-md);
    text-align: center;
    background: linear-gradient(135deg, var(--primary), var(--secondary));
    z-index: var(--z-index-sticky);
    box-shadow: var(--shadow-medium);
    border-radius: var(--card-border-radius);
    border-bottom: none;
    position: relative;
  }

  .fixed-header h1 {
    font-size: var(--spacing-xl);
    margin-bottom: 0;
    color: var(--button-text);
  }

  .fixed-header p {
    color: rgba(255, 255, 255, 0.9);
    margin: 0;
    font-size: var(--font-size-md);
  }

  .back-button {
    position: absolute;
    right: var(--spacing-md);
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--btn-icon-size);
    height: var(--btn-icon-size);
    background: rgba(255, 255, 255, 0.2);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: var(--btn-transition);
  }

  .back-button:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: translateY(-50%) scale(var(--hover-scale));
  }

  :global(.back-button svg) {
    color: var(--button-text);
    stroke: var(--button-text);
  }

  .scrollable-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-lg);
    height: 100%;
    background-color: var(--surface);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-xxxl) 0;
    text-align: center;
    color: var(--text-secondary);
    border-radius: var(--card-border-radius);
    box-shadow: var(--shadow-subtle);
    margin: var(--spacing-lg) auto;
    max-width: 500px;
    padding: var(--spacing-xxxl) var(--spacing-lg);
  }

  .scale-in {
    animation: scaleIn var(--transition-normal) ease forwards;
  }

  .empty-state h2 {
    margin: var(--spacing-lg) 0 var(--spacing-sm);
    font-size: var(--spacing-lg);
    color: var(--text-primary);
  }

  .empty-state p {
    margin: 0;
  }

  .error-message {
    margin: var(--spacing-lg);
    padding: var(--spacing-md);
    background-color: rgba(211, 47, 47, 0.1);
    color: var(--error);
    border-radius: var(--card-border-radius);
    font-size: var(--font-size-sm);
    text-align: center;
    border-left: 3px solid var(--error);
  }

  .carts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: var(--spacing-xl);
    padding-bottom: var(--spacing-xl);
    max-width: 1400px;
    margin: 0 auto;
  }

  .loading {
    display: flex;
    justify-content: center;
    padding: var(--spacing-xl);
    font-size: var(--btn-font-size-md);
    color: var(--text-secondary);
  }
</style>