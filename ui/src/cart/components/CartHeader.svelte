<script lang="ts">
    import { X } from "lucide-svelte";
    export let onClose: () => void;
    export let isClosing: boolean = false;
</script>

<div 
    class="cart-header {isClosing ? 'slide-out-up' : 'slide-in-down'}"
>
    <button class="close-btn" on:click={onClose}>
        <X size={20} />
    </button>
    <h2>Shopping Cart</h2>
</div>

<style>
    .cart-header {
        height: var(--component-header-height);
        box-sizing: border-box;
        padding: 0 var(--spacing-xl);
        display: flex;
        align-items: center;
        position: relative;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
    }

    .cart-header h2 {
        margin: 0;
        font-size: var(--spacing-lg);
        font-weight: var(--font-weight-semibold);
        flex-grow: 1;
        text-align: center;
        color: var(--button-text);
        line-height: 1;
    }

    .close-btn {
        position: absolute;
        left: var(--spacing-lg);
        top: 50%;
        transform: translateY(-50%);
        background: rgba(255, 255, 255, 0.2);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--btn-icon-size-sm);
        height: var(--btn-icon-size-sm);
        border-radius: 50%;
        transition: var(--btn-transition);
        box-shadow: var(--shadow-button);
        transform-origin: center;
        padding: 0;
    }

    .close-btn:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: translateY(-50%) scale(var(--hover-scale));
        box-shadow: var(--shadow-medium);
    }

    .close-btn :global(svg) {
        color: var(--button-text);
        stroke: var(--button-text);
        fill: currentColor;
    }
</style>
