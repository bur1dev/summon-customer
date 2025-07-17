<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { ArrowLeft, MapPin, Clock } from "lucide-svelte";
  import OrderProductList from "./OrderProductList.svelte";
  

  // Props
  export let item: any;

  // Event dispatcher
  const dispatch = createEventDispatcher();

  // Format status for display
  function formatStatus(status: any): string {
    switch (status) {
      case "processing":
        return "Processing";
      case "completed":
        return "Completed";
      case "returned":
        return "Returned to Cart";
      default:
        return status;
    }
  }

  // Handle return to shopping
  function handleReturnToShopping() {
    dispatch("returnToShopping");
  }
</script>

<div class="cart-card scale-in">
  <div class="cart-header">
    <div class="order-info">
      {#if item.total}
        {@const estimatedTax = Math.round(item.total * 0.0775 * 100) / 100}
        {@const orderTotal = item.total + estimatedTax}
        <h2>Order ${orderTotal.toFixed(2)}</h2>
        <div class="cart-pricing">
          <span class="subtotal">Items: ${item.total.toFixed(2)}</span>
          <span class="tax">Tax: ${estimatedTax.toFixed(2)}</span>
        </div>
      {:else}
        <h2>Order</h2>
      {/if}
      <div class="cart-date">{item.createdAt}</div>
      <div class="cart-status status-{item.status}">
        Status: {formatStatus(item.status)}
      </div>
    </div>

  </div>

  {#if item.deliveryAddress || item.deliveryTime}
    <div class="delivery-details">
      {#if item.deliveryAddress}
        {@const address = item.deliveryAddress}
        <div class="delivery-address">
          <div class="delivery-icon">
            <MapPin size={16} />
          </div>
          <div class="delivery-content">
            <div class="delivery-label">Delivery Address:</div>
            <div class="address-line">
              {address.street}
              {#if address.unit}
                <span class="unit">{address.unit}</span>
              {/if}
            </div>
            <div class="address-line">
              {address.city}, {address.state}
              {address.zip}
            </div>
          </div>
        </div>
      {/if}

      {#if item.deliveryTime}
        <div class="delivery-time">
          <div class="delivery-icon">
            <Clock size={16} />
          </div>
          <div class="delivery-content">
            <div class="delivery-label">Delivery Time:</div>
            <div>
              {item.deliveryTime.date} at {item.deliveryTime.time}
            </div>
          </div>
        </div>
      {/if}

      {#if item.deliveryInstructions}
        <div class="delivery-instructions">
          <div class="delivery-label">Instructions:</div>
          <div>{item.deliveryInstructions}</div>
        </div>
      {/if}
    </div>
  {/if}

  <OrderProductList products={item.products} />

  <button
    class="return-button"
    on:click={handleReturnToShopping}
  >
    <ArrowLeft size={16} />
    Return to Shopping
  </button>
</div>

<style>
  .cart-card {
    background: var(--background);
    border-radius: var(--card-border-radius);
    box-shadow: var(--shadow-medium);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: var(--card-transition);
  }

  .cart-card:hover {
    transform: translateY(var(--hover-lift));
    box-shadow: var(--shadow-medium);
  }

  .scale-in {
    animation: scaleIn var(--transition-normal) ease forwards;
  }

  .cart-header {
    padding: var(--spacing-md);
    border-bottom: var(--border-width-thin) solid var(--border);
    background: linear-gradient(
      135deg,
      rgba(86, 98, 189, 0.1),
      rgba(112, 70, 168, 0.1)
    );
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .order-info {
    flex: 1;
  }

  .cart-header h2 {
    margin: 0;
    font-size: var(--btn-font-size-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .cart-date {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-top: 4px;
  }

  .cart-status {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    margin-top: 4px;
  }

  .cart-pricing {
    display: flex;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    gap: var(--spacing-sm);
    margin-top: 4px;
  }


  .status-processing {
    color: var(--warning);
  }

  .status-completed {
    color: var(--success);
  }

  .status-returned {
    color: var(--text-secondary);
  }

  .delivery-details {
    padding: var(--spacing-md);
    background-color: var(--surface);
    border-bottom: var(--border-width-thin) solid var(--border);
  }

  .delivery-address,
  .delivery-time {
    display: flex;
    margin-bottom: var(--spacing-sm);
  }

  .delivery-icon {
    margin-right: var(--spacing-sm);
    color: var(--primary);
  }

  :global(.delivery-icon svg) {
    color: var(--primary);
    stroke: var(--primary);
  }

  .delivery-content {
    flex: 1;
  }

  .delivery-label {
    font-weight: var(--font-weight-semibold);
    margin-bottom: 4px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .address-line {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .delivery-instructions {
    margin-top: var(--spacing-sm);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    background-color: var(--surface);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--btn-border-radius);
    border-left: var(--border-width) solid var(--primary);
  }

  .return-button {
    margin: var(--spacing-md);
    height: var(--btn-height-md);
    background: linear-gradient(135deg, var(--primary), var(--secondary));
    border: none;
    color: var(--button-text);
    border-radius: var(--btn-border-radius);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    transition: var(--btn-transition);
    box-shadow: var(--shadow-button);
  }

  .return-button:hover {
    background: linear-gradient(135deg, var(--primary-dark), var(--secondary));
    transform: translateY(var(--hover-lift));
    box-shadow: var(--shadow-medium);
  }

  :global(.return-button svg) {
    color: var(--button-text);
    stroke: var(--button-text);
  }
</style>