<script lang="ts">
    import { Plus, Minus } from "lucide-svelte";
    import { updateQuantity } from "../../../cart/services/CartInteractionService";
    import { getIncrementValue, formatQuantityDisplay } from "../../../cart/utils/cartHelpers";
    import { clickable } from "../../../shared/actions/clickable";
    
    // CartBusinessService no longer needed as prop
    export let product: any;
    export let quantity: number;
    export let isInCart: boolean;
    export let isTransitioning: boolean;
    export let onQuantityChange: (newQuantity: number) => void;
    export let onAddToCart: () => Promise<void>;
    export let onTransitionStart: () => void;
    export let onTransitionEnd: () => void;
    
    $: incrementValue = getIncrementValue(product);
    
    function formatQuantity(qty: number): string {
        return formatQuantityDisplay(qty, product);
    }

    async function incrementQuantity() {
        const newQuantity = quantity + incrementValue;
        onQuantityChange(newQuantity);
        
        if (isInCart) {
            await updateQuantity(
                product,
                newQuantity
            );
        }
    }

    async function decrementQuantity() {
        const newQuantity = Math.max(0, quantity - incrementValue);
        
        if (newQuantity === 0) {
            onTransitionStart();
            
            setTimeout(() => {
                onQuantityChange(incrementValue); // Reset to default
                onTransitionEnd();
            }, 300);
        } else {
            onQuantityChange(newQuantity);
        }
        
        if (isInCart) {
            await updateQuantity(
                product,
                newQuantity
            );
        }
    }

</script>

<div class="quantity-control-container">
    <!-- Not-in-cart quantity controls -->
    <div
        class="quantity-control {isInCart
            ? 'slide-out-right hide'
            : 'slide-in-left'} {isTransitioning
            ? 'transitioning'
            : ''}"
    >
        <div class="quantity-selector">
            <button
                class="quantity-button btn btn-icon btn-icon-primary"
                on:click={decrementQuantity}
                disabled={quantity <= incrementValue}
            >
                <Minus size={20} />
            </button>
            <span class="quantity-display"
                >{formatQuantity(quantity)}</span
            >
            <button
                class="quantity-button btn btn-icon btn-icon-primary"
                on:click={incrementQuantity}
            >
                <Plus size={20} />
            </button>
        </div>
        <button
            class="add-to-cart-button btn btn-primary btn-md"
            on:click={onAddToCart}
        >
            Add to cart
        </button>
    </div>

    <!-- In-cart quantity controls -->
    <div
        class="quantity-control in-cart {isInCart
            ? 'slide-in-left'
            : 'slide-out-right hide'} {isTransitioning
            ? 'transitioning'
            : ''}"
    >
        <div class="counter-btn-group">
            <span
                class="counter-btn minus"
                aria-label="Decrease quantity"
                use:clickable={{ handler: decrementQuantity, stopPropagation: true }}
            >
                <Minus size={20} />
            </span>
            <span class="counter-value"
                >{formatQuantity(quantity)} in cart</span
            >
            <span
                class="counter-btn plus"
                aria-label="Increase quantity"
                use:clickable={{ handler: incrementQuantity, stopPropagation: true }}
            >
                <Plus size={20} />
            </span>
        </div>
    </div>
</div>

<style>
    /* Quantity control container for transitions */
    .quantity-control-container {
        position: relative;
        height: 120px; /* Fixed height to prevent layout shift */
    }

    .quantity-control {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        transition: all var(--transition-normal) ease;
    }

    /* Hide elements when they're not active */
    .quantity-control.hide {
        visibility: hidden;
        opacity: 0;
    }

    /* Animation classes */
    .quantity-control.slide-in-left {
        animation: slideInLeft var(--transition-normal) ease forwards;
    }

    .quantity-control.slide-out-right {
        animation: slideOutRight var(--transition-normal) ease forwards;
    }

    /* Animation pause during transition */
    .quantity-control.transitioning {
        animation-play-state: running;
    }

    .quantity-selector {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        width: fit-content;
    }

    .quantity-display {
        min-width: 60px;
        text-align: center;
        font-size: 17px;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        padding: 0 var(--spacing-sm);
    }

    .add-to-cart-button {
        width: 100%;
    }

    /* In-cart styling */
    .quantity-control.in-cart {
        width: 100%;
    }

    /* Counter button styling from app.css */
    .counter-btn-group {
        width: 100%;
        max-width: 100%; /* Ensure it doesn't exceed container width */
        box-sizing: border-box;
    }

    /* Make the add-to-cart and in-cart buttons the same width */
    .add-to-cart-button,
    .counter-btn-group {
        width: 100%;
        box-sizing: border-box;
    }

    .counter-btn {
        cursor: pointer;
    }

    .counter-value {
        min-width: 120px; /* Ensure enough space for "in cart" text */
        white-space: nowrap;
    }

    /* Additional styling for quantity button icons */
    :global(.quantity-button svg),
    :global(.cart-quantity-button svg),
    :global(.counter-btn svg) {
        color: var(--button-text);
        stroke: var(--button-text);
    }

    @media (max-width: 1024px) {
        .quantity-control-container {
            height: 150px; /* Increase height for mobile layout */
        }
    }
</style>