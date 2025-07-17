<script lang="ts">
    import { PencilLine, Plus, Minus } from "lucide-svelte";
    import { calculateItemTotal, hasPromoPrice, formatPriceWithUnit, formatTotal, formatSavings } from "../../utils/priceUtils";
    import { decrementItem, incrementItem, removeItem } from "../services/CartInteractionService";
    import { getDisplayUnit, getIncrementValue } from "../utils/cartHelpers";
    import ProductDetailModal from "../../products/components/modal/ProductDetailModal.svelte";
    import CartItem from "./items/CartItem.svelte";
    import { startItemRemoval } from "../../utils/animationUtils";
    import { preferences, loadPreference, getPreferenceKey } from "../../products/services/PreferencesService";

    // SIMPLIFIED: Props for new CartItem structure
    export let cartItem: any = null; // New: Complete cart item with all data
    export let variant: "cart" | "checkout" = "cart"; // Layout control

    // SIMPLIFIED: All data comes from cartItem now
    $: product = cartItem ? {
        name: cartItem.productName,
        image_url: cartItem.productImageUrl,
        price: cartItem.priceAtCheckout,
        promo_price: cartItem.promoPrice || cartItem.priceAtCheckout, // Use promo price if available
        sold_by: cartItem.soldBy || "UNIT", // Use actual soldBy from cart item
        // CART ONLY NEEDS: productId string for identification
        productId: cartItem.productId,
        upc: cartItem.upc // Include UPC for preference lookups
    } : {
        name: "Unknown Product",
        image_url: null,
        price: 0,
        promo_price: 0,
        sold_by: "UNIT",
        productId: null,
        upc: null
    };
    $: quantity = cartItem?.quantity || 0;
    
    // Preference loading using UPC directly
    $: upc = cartItem?.upc;
    $: preferenceKey = upc ? getPreferenceKey(upc) : null;
    $: preferenceData = preferenceKey ? ($preferences[preferenceKey] || { preference: null }) : { preference: null };
    $: preferenceNote = preferenceData.preference?.note;
    
    // Display note: stored preference only (simplified from dual-layer system)
    $: note = preferenceNote || null;

    // Cart service is now store-based, no context needed

    // State for modal and animation
    let showModal = false;
    let isRemoving = false;
    let cartItemElement: HTMLElement | undefined;
    let checkoutItemElement: HTMLElement;

    // Use cart helpers for product properties
    $: displayUnit = getDisplayUnit(product);

    // SIMPLIFIED: Use PriceService for calculations with frozen price
    $: itemTotals = calculateItemTotal(product, quantity);
    $: hasPromo = hasPromoPrice(product);

    // SIMPLIFIED: Cart interactions using product object
    const handleDecrementItem = async () => {
        // Check if decrementing will result in removal (use proper increment value)
        const incrementValue = getIncrementValue(product);
        const newQuantity = quantity - incrementValue;
        
        if (newQuantity <= 0) {
            isRemoving = true;
            const element =
                variant === "cart" ? cartItemElement : checkoutItemElement;
            if (element) {
                await startItemRemoval(element);
            }
        }

        await decrementItem(product, quantity);
    };

    const handleIncrementItem = async () => {
        await incrementItem(product, quantity);
    };

    const handleRemove = async () => {
        isRemoving = true;

        // Use AnimationService instead of manual timeout
        const element =
            variant === "cart" ? cartItemElement : checkoutItemElement;
        if (element) {
            await startItemRemoval(element);
        }

        // Then remove from cart
        await removeItem(product);
    };

    const handleInstructionsClick = () => {
        showModal = true;
    };
    
    // Load preference when component mounts
    $: if (upc) {
        loadPreference(upc);
    }
</script>

{#if variant === "cart"}
    <!-- Cart variant - uses existing CartItem wrapper and component structure -->
    <CartItem
        bind:element={cartItemElement}
        id={cartItem?.productId || "unknown"}
        class={isRemoving ? "item-removing" : ""}
    >
        <div class="cart-item-content">
            <!-- Product Display Section -->
            <div class="cart-item-img">
                {#if product?.image_url}
                    <img
                        src={product.image_url}
                        alt={product.name || "Product"}
                    />
                {/if}
            </div>

            <div class="cart-item-left">
                <div class="cart-item-name">
                    {product?.name || "Unknown Product"}
                </div>

                <!-- Price display using PriceService -->
                <div class="cart-item-price">
                    <span
                        >{formatPriceWithUnit(
                            product?.price || 0,
                            product?.sold_by,
                        )}</span
                    >
                    {#if hasPromo}
                        <span class="price-separator">/</span>
                        <span class="promo-price">
                            {formatPriceWithUnit(
                                product.promo_price,
                                product?.sold_by,
                            )}
                        </span>
                    {/if}
                </div>

                {#if note}
                    <div class="shopper-note">
                        Shopper note: {note}
                    </div>
                {/if}
                <button
                    class="instructions-link"
                    on:click|stopPropagation={handleInstructionsClick}
                >
                    <PencilLine size={16} />
                    <span
                        >{note && note.trim().length > 0
                            ? "Edit preference"
                            : "Add preference"}</span
                    >
                </button>
            </div>

            <!-- Actions Section -->
            <div class="cart-item-right">
                <div class="quantity-control">
                    <button
                        class="quantity-btn minus-btn"
                        on:click|stopPropagation={handleDecrementItem}
                        disabled={false}
                    >
                        <Minus size={16} />
                    </button>
                    <span class="quantity-display"
                        >{quantity} {displayUnit}</span
                    >
                    <button
                        class="quantity-btn plus-btn"
                        on:click|stopPropagation={handleIncrementItem}
                        disabled={false}
                    >
                        <Plus size={16} />
                    </button>
                </div>

                <!-- Total price using PriceService -->
                <div class="cart-item-total">
                    <span class="total-regular"
                        >{formatTotal(itemTotals.regular)}</span
                    >
                    {#if hasPromo}
                        <span class="total-promo"
                            >{formatTotal(itemTotals.promo)}</span
                        >
                        {#if itemTotals.savings > 0}
                            <span class="total-savings"
                                >You save {formatSavings(
                                    itemTotals.savings,
                                )}</span
                            >
                        {/if}
                    {/if}
                </div>

                <button
                    class="btn btn-text remove-item"
                    on:click|stopPropagation={handleRemove}
                    disabled={false}
                >
                    Remove
                </button>
            </div>
        </div>
    </CartItem>
{:else}
    <!-- Checkout variant - matches CheckoutOrderItem layout -->
    <div
        bind:this={checkoutItemElement}
        class="order-item cart-item {isRemoving ? 'item-removing' : ''}"
    >
        <div class="item-image">
            {#if product?.image_url}
                <img
                    src={product.image_url}
                    alt={product?.name || "Product"}
                />
            {/if}
        </div>

        <div class="item-content">
            <div class="item-left">
                <div class="item-name">
                    {product?.name || "Unknown Product"}
                </div>

                <!-- Price display using PriceService -->
                <div class="item-quantity-price">
                    <span class="item-unit-price">
                        {formatPriceWithUnit(
                            product?.price || 0,
                            product?.sold_by,
                        )}
                    </span>
                    {#if hasPromo}
                        <span class="price-separator">/</span>
                        <span class="item-unit-price promo-price">
                            {formatPriceWithUnit(
                                product.promo_price,
                                product?.sold_by,
                            )}
                        </span>
                    {/if}
                </div>

                {#if note}
                    <div class="shopper-note">
                        Shopper note: {note}
                    </div>
                {/if}
                <button
                    class="instructions-link"
                    on:click={handleInstructionsClick}
                >
                    <PencilLine size={14} />
                    <span
                        >{note
                            ? "Edit preference"
                            : "Add preference"}</span
                    >
                </button>
            </div>
            <div class="item-right">
                <div class="quantity-control">
                    <button
                        class="quantity-btn minus-btn"
                        on:click|stopPropagation={handleDecrementItem}
                    >
                        <Minus size={14} />
                    </button>
                    <span class="quantity-display">
                        {quantity}
                        {displayUnit}
                    </span>
                    <button
                        class="quantity-btn plus-btn"
                        on:click|stopPropagation={handleIncrementItem}
                    >
                        <Plus size={14} />
                    </button>
                </div>

                <!-- Item totals using PriceService -->
                <div class="item-price">
                    <span class="price-amount"
                        >{formatTotal(itemTotals.regular)}</span
                    >
                    {#if hasPromo}
                        <span class="promo-amount"
                            >{formatTotal(itemTotals.promo)}</span
                        >
                        {#if itemTotals.savings > 0}
                            <span class="item-savings"
                                >You save {formatSavings(
                                    itemTotals.savings,
                                )}</span
                            >
                        {/if}
                    {/if}
                </div>

                <button
                    class="btn btn-text remove-item"
                    on:click|stopPropagation={handleRemove}
                >
                    Remove
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- ProductDetailModal for preference editing - same for both variants -->
<ProductDetailModal
    bind:isOpen={showModal}
    product={product}
    forceShowPreferences={true}
/>

<style>
    /* Cart variant styles */
    .cart-item-content {
        flex: 1;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
    }

    .cart-item-img {
        width: 70px;
        height: 70px;
        margin-right: var(--spacing-md);
        flex-shrink: 0;
        overflow: hidden;
        border-radius: var(--card-border-radius);
    }

    .cart-item-img img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: top;
    }

    .cart-item-left {
        flex: 1;
        margin-right: var(--spacing-lg);
        min-width: 0;
        overflow-wrap: break-word;
    }

    .cart-item-name {
        font-weight: var(--font-weight-semibold);
        margin-bottom: var(--spacing-xs);
        font-size: var(--font-size-md);
        color: var(--text-primary);
        word-wrap: break-word;
        overflow-wrap: break-word;
        hyphens: auto;
        max-width: 100%;
    }

    .cart-item-price {
        font-size: var(--font-size-sm);
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        color: var(--text-secondary);
    }

    .shopper-note {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        margin-bottom: 4px;
        width: 100%;
        max-width: 100%;
        word-wrap: break-word;
        overflow-wrap: break-word;
        word-break: break-all;
        white-space: pre-wrap;
        hyphens: auto;
        background-color: var(--surface);
        padding: 4px var(--spacing-xs);
        border-radius: 4px;
        border-left: var(--border-width) solid var(--primary);
        box-sizing: border-box;
    }

    .cart-item-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--spacing-xs);
    }

    .cart-item-total {
        text-align: right;
    }

    .total-regular {
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-md);
        color: var(--text-primary);
        display: block;
    }

    .total-promo {
        font-size: var(--font-size-sm);
        color: var(--primary);
        font-weight: var(--font-weight-semibold);
        display: block;
    }

    .total-savings {
        font-size: var(--font-size-sm);
        color: var(--success);
        font-weight: var(--font-weight-semibold);
        display: block;
    }

    /* Checkout variant styles */
    .order-item {
        display: flex;
        padding: var(--spacing-sm) 0;
        align-items: flex-start;
        border-bottom: var(--border-width-thin) solid var(--border);
    }

    .item-image {
        width: 70px;
        height: 70px;
        margin-right: var(--spacing-sm);
        flex-shrink: 0;
        border-radius: var(--card-border-radius);
    }

    .item-image img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: var(--btn-border-radius);
        background-color: var(--surface);
        padding: 4px;
        border-radius: var(--card-border-radius);
    }

    .item-content {
        flex: 1;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
    }

    .item-left {
        flex: 0 1 auto;
        margin-right: var(--spacing-lg);
        width: calc(100% - 140px);
        overflow: hidden;
    }

    .item-name {
        font-weight: var(--font-weight-semibold);
        margin-bottom: 4px;
        color: var(--text-primary);
        word-wrap: break-word;
        overflow-wrap: break-word;
        hyphens: auto;
        max-width: 100%;
    }

    .item-quantity-price {
        display: flex;
        font-size: var(--font-size-sm);
        gap: var(--spacing-xs);
        align-items: center;
        margin-bottom: 4px;
        color: var(--text-secondary);
    }

    .item-unit-price {
        color: var(--text-secondary);
    }


    .item-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        width: 120px;
        flex: 0 0 120px;
    }

    .item-price {
        text-align: right;
    }

    .price-amount {
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-md);
        text-align: right;
        color: var(--text-primary);
        display: block;
    }

    .promo-amount {
        font-size: var(--font-size-sm);
        color: var(--primary);
        font-weight: var(--font-weight-semibold);
        display: block;
    }

    .item-savings {
        font-size: var(--font-size-sm);
        color: var(--success);
        font-weight: var(--font-weight-semibold);
        display: block;
    }

    /* Shared styles for both variants */
    .price-separator {
        margin: 0 4px;
        color: var(--text-secondary);
    }

    .promo-price {
        color: var(--primary);
        font-weight: var(--font-weight-semibold);
    }

    .instructions-link {
        background: transparent;
        border: none;
        color: var(--primary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        padding: 4px var(--spacing-xs);
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
        border-radius: var(--btn-border-radius);
        transition: var(--btn-transition);
    }

    .instructions-link:hover {
        background-color: var(--surface);
        transform: translateY(var(--hover-lift));
    }

    .quantity-control {
        width: 140px;
        height: var(--btn-height-sm);
        border-radius: 30px;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        display: flex;
        justify-content: space-between;
        padding: 0;
        overflow: hidden;
        border: none;
        box-shadow: var(--shadow-button);
    }

    .quantity-btn {
        width: var(--btn-height-sm);
        height: var(--btn-height-sm);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: var(--btn-transition);
        background-color: rgba(0, 0, 0, 0.15);
        border-radius: 50%;
    }

    .quantity-btn.minus-btn {
        margin-right: -5px;
    }

    .quantity-btn.plus-btn {
        margin-left: -5px;
    }

    .quantity-btn:hover {
        background-color: rgba(0, 0, 0, 0.3);
        transform: scale(var(--hover-scale-subtle));
    }

    :global(.quantity-btn svg) {
        color: var(--button-text);
        stroke: var(--button-text);
    }

    .quantity-btn:disabled {
        background-color: rgba(0, 0, 0, 0.1);
        cursor: not-allowed;
        opacity: 0.7;
    }

    :global(.quantity-btn:disabled svg) {
        color: var(--button-text);
        opacity: 0.5;
        stroke: var(--button-text);
    }

    .quantity-display {
        min-width: 60px;
        text-align: center;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--button-text);
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        padding: 0 var(--spacing-xs);
    }

    .remove-item {
        color: var(--error);
        font-size: var(--font-size-sm);
        padding: 4px var(--spacing-xs);
    }

    .remove-item:hover {
        background-color: rgba(211, 47, 47, 0.1);
        text-decoration: underline;
        color: var(--error);
    }
</style>
