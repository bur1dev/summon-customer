<script lang="ts">
    import { getDisplayPrices } from "../../../utils/priceUtils";
    
    export let product: any;
    
    $: displayPrices = getDisplayPrices(product);
</script>

<div class="product-price">
    {#if displayPrices.hasPromo}
        <div class="promo-price-line">
            <span class="promo-price">{displayPrices.promoPrice}</span>
        </div>
        <div class="regular-price-line">
            <span class="regular-price">{displayPrices.regularPrice}</span>
        </div>
        <div class="loyalty-label">
            {displayPrices.loyaltyLabel}
        </div>
    {:else}
        <div class="current-price-line">
            <span class="current-price">{displayPrices.soloPrice}</span>
        </div>
    {/if}
</div>

<style>
    .product-price {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .promo-price-line,
    .current-price-line,
    .regular-price-line {
        display: flex;
        align-items: baseline;
    }

    .promo-price,
    .current-price {
        font-size: 28px;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        line-height: 1;
    }

    .regular-price {
        font-size: 15px;
        color: var(--text-secondary);
        text-decoration: line-through;
        line-height: 1;
    }

    .loyalty-label {
        background-color: var(--warning);
        color: #684500;
        padding: 3px 6px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: var(--font-weight-semibold);
        display: inline-block;
        width: fit-content;
    }
</style>