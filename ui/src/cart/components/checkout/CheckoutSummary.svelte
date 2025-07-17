<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { Address } from "../../services/AddressService";
    // CartBusinessService no longer exported
    import CheckoutOrderList from "./CheckoutOrderList.svelte";
    import CheckoutPriceSummary from "./CheckoutPriceSummary.svelte";

    // Props
    export let cartItems: any[] = [];
    export let address: Address;
    export let deliveryInstructions: string = "";
    export let deliveryTime: { date: Date; display: string } | null = null;
    export let isEntering = true;
    export let isExiting = false;
    
    // Local state for placing order
    let isPlacingOrder = false;

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Handle checkout button click
    function handlePlaceOrder() {
        isPlacingOrder = true;
        dispatch("placeOrder");
    }

    // Handle edit actions
    function editDeliveryAddress() {
        dispatch("editAddress");
    }

    function editDeliveryTime() {
        dispatch("editTime");
    }
</script>

<div class="checkout-summary">
    <div class="checkout-summary-header">
        <h2
            class={isEntering
                ? "slide-in-left"
                : isExiting
                  ? "slide-out-left"
                  : ""}
        >
            Order Summary
        </h2>
    </div>

    <div class="summary-content">
        <div class="summary-sections">
            <div class="summary-section">
                <div class="section-header">
                    <h3
                        class={isEntering
                            ? "slide-in-left"
                            : isExiting
                              ? "slide-out-left"
                              : ""}
                    >
                        Delivery Address
                    </h3>
                    <div
                        class="edit-button-wrapper {isEntering
                            ? 'slide-in-right'
                            : isExiting
                              ? 'slide-out-right'
                              : ''}"
                    >
                        <button
                            class="edit-button"
                            on:click={editDeliveryAddress}>Edit</button
                        >
                    </div>
                </div>
                <div
                    class="address-details {isEntering
                        ? 'slide-in-left'
                        : isExiting
                          ? 'slide-out-left'
                          : ''}"
                >
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
                    {#if deliveryInstructions}
                        <div class="delivery-instructions">
                            <span class="instructions-label">Instructions:</span
                            >
                            {deliveryInstructions}
                        </div>
                    {/if}
                </div>
            </div>

            {#if deliveryTime}
                <div class="summary-section">
                    <div class="section-header">
                        <h3
                            class={isEntering
                                ? "slide-in-left"
                                : isExiting
                                  ? "slide-out-left"
                                  : ""}
                        >
                            Delivery Time
                        </h3>
                        <div
                            class="edit-button-wrapper {isEntering
                                ? 'slide-in-right'
                                : isExiting
                                  ? 'slide-out-right'
                                  : ''}"
                        >
                            <button class="edit-button" on:click={editDeliveryTime}
                                >Edit</button
                            >
                        </div>
                    </div>
                    <div
                        class="time-details {isEntering
                            ? 'slide-in-left'
                            : isExiting
                              ? 'slide-out-left'
                              : ''}"
                    >
                        <div class="time-date">
                            {#if deliveryTime.date}
                                {new Date(deliveryTime.date).toLocaleDateString("en-US", {
                                    weekday: "long",
                                    month: "long",
                                    day: "numeric",
                                    year: "numeric",
                                })}
                            {:else}
                                No date selected
                            {/if}
                        </div>
                        <div class="time-slot">{deliveryTime.display || 'No time selected'}</div>
                    </div>
                </div>
            {:else}
                <div class="summary-section">
                    <div class="section-header">
                        <h3
                            class={isEntering
                                ? "slide-in-left"
                                : isExiting
                                  ? "slide-out-left"
                                  : ""}
                        >
                            Delivery Time
                        </h3>
                        <div
                            class="edit-button-wrapper {isEntering
                                ? 'slide-in-right'
                                : isExiting
                                  ? 'slide-out-right'
                                  : ''}"
                        >
                            <button class="edit-button" on:click={editDeliveryTime}
                                >Edit</button
                            >
                        </div>
                    </div>
                    <div
                        class="time-details {isEntering
                            ? 'slide-in-left'
                            : isExiting
                              ? 'slide-out-left'
                              : ''}"
                    >
                        <div class="time-date">No delivery time selected</div>
                        <div class="time-slot">Please select a delivery time</div>
                    </div>
                </div>
            {/if}

            <CheckoutOrderList
                {cartItems}
                {isEntering}
                {isExiting}
                on:containerBound
            />
        </div>

        <CheckoutPriceSummary
            {cartItems}
            {isEntering}
            {isExiting}
            on:placeOrder={handlePlaceOrder}
        />
    </div>

    <div
        class="checkout-actions {isEntering
            ? 'slide-in-up'
            : isExiting
              ? 'slide-out-down'
              : ''}"
    >
        <button
            class="place-order-btn"
            on:click={handlePlaceOrder}
            disabled={isPlacingOrder}
        >
            {#if isPlacingOrder}
                Placing Order...
            {:else}
                Place Order
            {/if}
        </button>
    </div>
</div>

<style>
    .checkout-summary {
        background: var(--background);
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .checkout-summary-header {
        height: var(--component-header-height);
        box-sizing: border-box;
        padding: 0 var(--spacing-md);
        background: var(--background);
        border-bottom: var(--border-width-thin) solid var(--border);
        border-radius: var(--card-border-radius) var(--card-border-radius) 0 0;
        display: flex;
        align-items: center;
    }

    .checkout-summary-header h2 {
        margin: 0;
        font-size: var(--spacing-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .summary-content {
        padding: var(--spacing-md);
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden; /* Add this line */
    }

    .summary-sections {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xl);
        margin-bottom: var(--spacing-xl);
    }

    .summary-section {
        border-bottom: var(--border-width-thin) solid var(--border);
        padding-bottom: var(--spacing-md);
    }

    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-sm);
    }

    .section-header h3 {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .edit-button {
        background: var(--surface);
        border: var(--border-width-thin) solid var(--border);
        color: var(--primary);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        padding: 4px var(--spacing-sm);
        border-radius: var(--btn-border-radius);
        transition: var(--btn-transition);
    }

    .edit-button:hover {
        border-color: var(--primary);
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-subtle);
    }

    .address-details,
    .time-details {
        font-size: var(--font-size-sm);
        color: var(--text-primary);
        line-height: 1.5;
    }

    .address-line {
        margin-bottom: 4px;
    }

    .delivery-instructions {
        margin-top: var(--spacing-xs);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        background-color: var(--surface);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--btn-border-radius);
        border-left: var(--border-width) solid var(--primary);
    }

    .instructions-label {
        font-weight: var(--font-weight-semibold);
        margin-right: 4px;
        color: var(--primary);
    }

    .time-date {
        font-weight: var(--font-weight-semibold);
        margin-bottom: 4px;
    }

    .summary-content {
        padding: var(--spacing-md);
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .checkout-actions {
        padding: var(--spacing-lg);
        background: var(--background);
        border-top: var(--border-width-thin) solid var(--border);
        margin-top: auto;
    }

    .place-order-btn {
        width: 100%;
        height: var(--btn-height-lg);
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border: none;
        color: var(--button-text);
        border-radius: var(--btn-border-radius);
        font-size: var(--btn-font-size-md);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        text-align: center;
        transition: var(--btn-transition);
        box-shadow: var(--shadow-button);
    }

    .place-order-btn:hover:not(:disabled) {
        background: linear-gradient(
            135deg,
            var(--primary-dark),
            var(--secondary)
        );
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-medium);
    }

    .place-order-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        background: var(--surface);
        color: var(--text-secondary);
        border: var(--border-width-thin) solid var(--border);
        box-shadow: none;
    }

    /* Thin scrollbar styling */
    .summary-content::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }

    .summary-content::-webkit-scrollbar-track {
        background: var(--scrollbar-track);
    }

    .summary-content::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 3px;
    }

    .summary-content::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-thumb-hover);
    }

    /* For Firefox */
    .summary-content {
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }
</style>
