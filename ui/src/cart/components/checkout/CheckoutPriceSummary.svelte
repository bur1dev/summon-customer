<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { formatTotal, formatSavings } from "../../../utils/priceUtils";

    // Props
    export let cartItems: any[] = [];
    export let isEntering = true;
    export let isExiting = false;

    // Calculate totals with tax using CartItem data directly
    $: {
        let regularTotal = 0;
        let promoTotal = 0;

        cartItems.forEach((item: any) => {
            if (item) {
                // Use CartItem data directly - prices are already frozen
                const itemRegularTotal = item.priceAtCheckout * item.quantity;
                const itemPromoTotal = (item.promoPrice || item.priceAtCheckout) * item.quantity;
                
                regularTotal += itemRegularTotal;
                promoTotal += itemPromoTotal;
            }
        });

        itemsTotal = regularTotal;
        itemsPromoTotal = promoTotal;
        estimatedTax = Math.round(itemsPromoTotal * 0.0775 * 100) / 100; // 7.75% CA sales tax on promo prices
        subtotal = itemsPromoTotal + estimatedTax;
        totalSavings = regularTotal - promoTotal; // Direct calculation
    }

    // Variables for price calculation
    let itemsTotal = 0;
    let itemsPromoTotal = 0;
    let estimatedTax = 0;
    let subtotal = 0;
    let totalSavings = 0;

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Handle checkout button click
    function handlePlaceOrder() {
        dispatch("placeOrder");
    }
</script>

<!-- UPDATED: Price summary using PriceService -->
<div
    class="price-summary {isEntering
        ? 'slide-in-left'
        : isExiting
          ? 'slide-out-left'
          : ''}"
>
    <div class="price-row">
        <div class="price-label">Items Subtotal</div>
        <div class="price-value">
            {formatTotal(itemsTotal)}
        </div>
    </div>

    {#if totalSavings > 0}
        <div class="price-row savings-row">
            <div class="price-label">Loyalty Card Savings</div>
            <div class="price-value savings-value">
                -{formatSavings(totalSavings)}
            </div>
        </div>

        <div class="price-row promo-subtotal-row">
            <div class="price-label">Subtotal with Savings</div>
            <div class="price-value promo-value">
                {formatTotal(itemsPromoTotal)}
            </div>
        </div>
    {/if}

    <div class="price-row">
        <div class="price-label">Estimated Tax</div>
        <div class="price-value">
            {formatTotal(estimatedTax)}
        </div>
    </div>

    <div class="price-row total-row">
        <div class="price-label">Total</div>
        <div class="price-value">
            {formatTotal(subtotal)}
        </div>
    </div>
</div>

<style>
    /* Price summary styling */
    .price-summary {
        background-color: var(--surface);
        border-radius: var(--card-border-radius);
        padding: var(--spacing-md);
        margin-bottom: var(--spacing-xl);
        box-shadow: var(--shadow-subtle);
    }

    .price-row {
        display: flex;
        justify-content: space-between;
        padding: var(--spacing-xs) 0;
        font-size: var(--font-size-sm);
        color: var(--text-primary);
    }

    .savings-row {
        color: var(--success);
    }

    .savings-value {
        color: var(--success);
        font-weight: var(--font-weight-semibold);
    }

    .promo-subtotal-row {
        border-top: var(--border-width-thin) solid var(--border);
        border-bottom: var(--border-width-thin) solid var(--border);
        margin: var(--spacing-xs) 0;
        padding: var(--spacing-sm) 0;
    }

    .promo-value {
        color: var(--primary);
        font-weight: var(--font-weight-semibold);
    }

    .total-row {
        border-top: var(--border-width-thin) solid var(--border);
        margin-top: var(--spacing-xs);
        padding-top: var(--spacing-sm);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-md);
        color: var(--text-primary);
    }
</style>
