<script lang="ts">
    export let product: any;
</script>

<div class="product-image-container">
    {#if product.image_url}
        <img
            src={product.image_url}
            alt={product.name}
            class="product-image"
        />
    {/if}
</div>

<style>
    .product-image-container {
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .product-image {
        max-width: 100%;
        max-height: 320px;
        object-fit: contain;
        border-radius: var(--card-border-radius);
    }

    @media (max-width: 1024px) {
        .product-image-container {
            padding-top: 0;
        }
    }
</style>