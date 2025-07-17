<script lang="ts">
    import UnifiedCartItem from "../UnifiedCartItem.svelte";

    import { createEventDispatcher } from "svelte";
    
    // Props
    export let cartItems: any[] = [];
    export let isEntering = true;
    export let isExiting = false;
    
    // Local container for binding
    let orderItemsContainer: HTMLElement | undefined;
    
    const dispatch = createEventDispatcher();
    
    // Update parent when container is bound
    $: if (orderItemsContainer) {
        dispatch('containerBound', orderItemsContainer);
    }


</script>

<div class="summary-section">
    <h3 class={isEntering ? "slide-in-left" : isExiting ? "slide-out-left" : ""}>Order Details</h3>
    <div class="order-items" bind:this={orderItemsContainer}>
        {#each [...cartItems].sort((a, b) => (a.addedOrder || 0) - (b.addedOrder || 0)) as item (item.productId)}
            <UnifiedCartItem
                cartItem={item}
                variant="checkout"
            />
        {/each}
    </div>
</div>

<style>
    .summary-section {
        padding-bottom: var(--spacing-md);
    }

    .summary-section h3 {
        margin: 0 0 var(--spacing-sm) 0;
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .order-items {
        display: flex;
        flex-direction: column;
        /* No gap - will use margin instead */
        transition: all var(--transition-normal) ease;
    }

    /* Add spacing via margin on the items */
    .order-items :global(.order-item:not(:last-child)) {
        margin-bottom: var(--spacing-xs);
    }
</style>