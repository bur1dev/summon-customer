<script lang="ts">
  import { BarChart } from "lucide-svelte";

  export let product: any;
  export let displayPrices: any;
  export let stockInfo: any;
</script>

<div class="product-card-content">
  {#if product.image_url}
    <img src={product.image_url} alt={product.name} class="product-image" />
  {:else}
    <div class="product-image placeholder-image">No Image</div>
  {/if}
  
  <div class="prices">
    {#if displayPrices.hasPromo}
      <div class="price-row">
        <div class="promo-price">
          {displayPrices.promoPrice}
        </div>
        <div class="regular-price">
          {displayPrices.regularPrice}
        </div>
      </div>
      <div class="promo-label">{displayPrices.loyaltyLabel}</div>
    {:else}
      <div class="regular-price-solo">
        {displayPrices.soloPrice}
      </div>
    {/if}
  </div>
  
  <div class="name">{product.name}</div>
  <div class="size">{product.size}</div>
  <div class="stock" style="display: flex; align-items: center;">
    <BarChart
      size={30}
      style="margin-right: 5px; color: {stockInfo.color};"
    />
    {stockInfo.text}
  </div>
</div>

<style>
  .product-card-content {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 0;
  }

  .product-image {
    width: 100%;
    height: 245px;
    object-fit: contain;
    padding: 5px;
    box-sizing: border-box;
    display: block;
  }

  .placeholder-image {
    width: 100%;
    height: 245px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #f0f0f0;
    color: #ccc;
    font-size: 16px;
    box-sizing: border-box;
  }

  .prices {
    margin-bottom: 2px;
  }

  .price-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    margin-bottom: 4px;
  }

  .promo-price {
    font-size: 24px;
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    background-color: var(--warning);
    padding: 4px var(--spacing-xs);
    border-radius: 4px;
    display: inline-block;
  }

  .regular-price {
    font-size: var(--spacing-lg);
    color: var(--text-secondary);
  }

  .regular-price-solo {
    font-size: 24px;
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .promo-label {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    background-color: var(--warning);
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
  }

  .name {
    font-size: 18px;
    margin-bottom: 2px;
    line-height: 1.2;
    color: var(--text-primary);
  }

  .size {
    font-size: var(--font-size-md);
    color: var(--text-secondary);
    margin-bottom: 2px;
  }

  .stock {
    font-size: var(--font-size-md);
    color: var(--text-primary);
  }
</style>