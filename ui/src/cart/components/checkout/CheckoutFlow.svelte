<script lang="ts">
    import { createEventDispatcher, onMount, getContext } from "svelte";
    import { get } from "svelte/store";
    import { selectedCartAddress, selectedCartAddressHash } from "../../services/AddressService";
    import { publishOrder, selectedDeliveryTimeSlot, deliveryInstructions, generateDeliveryTimeSlots, validateCheckoutReadiness, saveDeliveryTimeSlot, saveDeliveryInstructions } from "../../services/CheckoutService";
    import AddressSelector from "../address/AddressSelector.svelte";
    import DeliveryTimeSelector from "../address/DeliveryTimeSelector.svelte";
    import CheckoutSummary from "./CheckoutSummary.svelte";
    import { ChevronLeft } from "lucide-svelte";
    import { stopCartZipper, startCartZipper, getAnimationDuration } from "../../../utils/animationUtils";


    // Props
    export let cartItems: any[] = [];
    export let onClose: () => void;
    export let isClosingCart = false;

    // Store context removed - direct service access used

    // Event dispatcher
    const dispatch = createEventDispatcher();



    // State
    let currentStep = 1;
    let deliveryTimeSlots: any[] = [];
    let checkoutError = "";
    let isEntering = true;
    let isExiting = false;

    // Animation (EXACT SlideOutCart pattern)
    let checkoutContainer: HTMLElement | undefined;
    let hasTriggeredCheckoutZipper = false;

    // Reset flag when entering step 3 (EXACT SlideOutCart pattern)
    $: if (currentStep === 3) {
        hasTriggeredCheckoutZipper = false;
        // Clean up any leftover animation classes when entering step 3
        if (checkoutContainer) {
            checkoutContainer.classList.remove("zipper-enter", "zipper-exit");
        }
    }

    // When cart is closing, trigger exit animations on all elements
    $: if (isClosingCart) {
        isEntering = false;
        isExiting = true;
    }

    // When cart is closing from step 3, trigger zipper animation
    $: if (isClosingCart && currentStep === 3 && checkoutContainer) {
        stopCartZipper(checkoutContainer);
    }

    // Reactive values from stores
    $: selectedAddress = $selectedCartAddress;
    $: selectedAddressHash = $selectedCartAddressHash;
    $: selectedTimeSlot = $selectedDeliveryTimeSlot;
    $: instructions = $deliveryInstructions;

    // Trigger zipper animation when step 3 loads (EXACT SlideOutCart pattern)
    $: if (
        currentStep === 3 &&
        cartItems.length > 0 &&
        checkoutContainer &&
        !hasTriggeredCheckoutZipper
    ) {
        startCartZipper(checkoutContainer);
        hasTriggeredCheckoutZipper = true;

        // Remove the animation class after it completes to prevent re-animation on DOM changes
        setTimeout(() => {
            if (checkoutContainer) {
                checkoutContainer.classList.remove("zipper-enter");
            }
        }, getAnimationDuration("smooth"));
    }

    // Initialize delivery time slots
    onMount(() => {
        deliveryTimeSlots = generateDeliveryTimeSlots();
    });

    // Handle address selection
    function handleAddressSelect({ detail }: { detail: any }) {
        // AddressSelector now handles the cart address coordination internally
        console.log("Address selected:", detail);
    }

    // Handle delivery instructions change
    function handleInstructionsChange({ detail }: { detail: any }) {
        deliveryInstructions.set(detail.instructions);
    }

    // Handle delivery time selection
    function handleTimeSelect({ detail }: { detail: any }) {
        selectedDeliveryTimeSlot.set(detail.deliveryTime);
    }

    // Validate the current state before proceeding
    function validateStep(currentStep: number): boolean {
        if (currentStep === 1) {
            return !!selectedAddress;
        }
        if (currentStep === 2) {
            return !!selectedTimeSlot;
        }
        return true;
    }

    // Navigation to specific step
    function goToStep(step: number) {
        if (step > currentStep && !validateStep(currentStep)) {
            return;
        }
        currentStep = step;
    }

    // Continue to next step
    function continueToNextStep() {
        if (!validateStep(currentStep)) {
            console.error(`Cannot proceed, step ${currentStep} is not valid`);
            return;
        }

        isEntering = false;
        isExiting = true;

        setTimeout(() => {
            currentStep++;
            isExiting = false;
            isEntering = true;
        }, getAnimationDuration("smooth"));
    }

    // Go back to previous step
    function goBack() {
        isEntering = false;
        isExiting = true;

        if (currentStep === 3 && checkoutContainer) {
            stopCartZipper(checkoutContainer);
        }

        setTimeout(() => {
            currentStep--;
            isExiting = false;
            isEntering = true;
        }, getAnimationDuration("smooth"));
    }

    // Handle back to cart
    function handleBackToCart() {
        isEntering = false;
        isExiting = true;

        if (currentStep === 3 && checkoutContainer) {
            stopCartZipper(checkoutContainer);
        }

        setTimeout(() => {
            onClose();
            isEntering = true;
            isExiting = false;
        }, getAnimationDuration("smooth"));
    }

    // Place the order using new backend system
    async function placeOrder() {
        const validation = validateCheckoutReadiness();
        if (!validation.ready) {
            checkoutError = validation.error || "Validation failed";
            return;
        }

        checkoutError = "";

        try {
            // 1. Save delivery time slot if selected
            const selectedTimeSlot = get(selectedDeliveryTimeSlot);
            if (selectedTimeSlot) {
                console.log('💾 Saving delivery time slot to DHT:', selectedTimeSlot);
                const timeResult = await saveDeliveryTimeSlot(selectedTimeSlot);
                if (!timeResult.success) {
                    checkoutError = "Failed to save delivery time. Please try again.";
                    return;
                }
            }

            // 2. Save delivery instructions if provided  
            const instructions = get(deliveryInstructions);
            if (instructions && instructions.trim()) {
                console.log('💾 Saving delivery instructions to DHT:', instructions);
                const instructionsResult = await saveDeliveryInstructions(instructions);
                if (!instructionsResult.success) {
                    checkoutError = "Failed to save delivery instructions. Please try again.";
                    return;
                }
            }

            // 3. Trigger exit animations immediately
            isEntering = false;
            isExiting = true;

            if (currentStep === 3 && checkoutContainer) {
                stopCartZipper(checkoutContainer);
            }

            // 4. Update session status to "Checkout" (existing logic)
            console.log('💾 Publishing order (updating session status)');
            const result = await publishOrder();
            if (result.success) {
                console.log("Order published successfully");
                dispatch("checkout-success", {
                    sessionHash: result.data
                });
            } else {
                console.error("Failed to publish order:", result.error);
                checkoutError = "Failed to place order. Please try again.";
                return;
            }

        } catch (error) {
            console.error('Error placing order:', error);
            checkoutError = "An error occurred while placing your order. Please try again.";
            return;
        }

        // Close cart after animations
        setTimeout(() => {
            onClose();
            isEntering = true;
            isExiting = false;
        }, getAnimationDuration("smooth"));
    }
</script>

<div class="checkout-flow">
    <div
        class="checkout-header {isEntering
            ? 'slide-in-down'
            : isExiting
              ? 'slide-out-up'
              : ''}"
    >
        <button
            class="back-button"
            on:click={currentStep > 1 ? goBack : handleBackToCart}
        >
            <ChevronLeft size={20} />
        </button>
        <h2
            class={isEntering
                ? "slide-in-down"
                : isExiting
                  ? "slide-out-up"
                  : ""}
        >
            {#if currentStep === 1}
                Delivery Address
            {:else if currentStep === 2}
                Delivery Time
            {:else}
                Review & Place Order
            {/if}
        </h2>
        <div class="steps-indicator">
            Step {currentStep} of 3
        </div>
    </div>

    <div
        class="checkout-content {currentStep === 3
            ? 'allow-scroll'
            : 'prevent-scroll'}"
    >
        {#if currentStep === 1}
            <div
                class="avatar-overlay {isEntering
                    ? 'slide-in-right'
                    : isExiting
                      ? 'slide-out-right'
                      : ''}"
            >
            </div>

            <AddressSelector
                deliveryInstructions={instructions}
                {isEntering}
                {isExiting}
                on:select={handleAddressSelect}
                on:instructionsChange={handleInstructionsChange}
            />

            <div
                class="nav-buttons {isEntering
                    ? 'slide-in-up'
                    : isExiting
                      ? 'slide-out-down'
                      : ''}"
            >
                <button
                    class="continue-btn"
                    on:click={continueToNextStep}
                    disabled={!selectedAddress}
                >
                    Continue to Delivery Time
                </button>
            </div>
        {:else if currentStep === 2}
            <div
                class="avatar-overlay {isEntering
                    ? 'slide-in-right'
                    : isExiting
                      ? 'slide-out-right'
                      : ''}"
            >
            </div>

            <DeliveryTimeSelector
                timeSlots={deliveryTimeSlots}
                selectedDate={selectedTimeSlot?.date ? new Date(selectedTimeSlot.date) : null}
                selectedTimeSlot={selectedTimeSlot?.time_slot || null}
                {isEntering}
                {isExiting}
                on:select={handleTimeSelect}
            />

            <div
                class="nav-buttons {isEntering
                    ? 'slide-in-up'
                    : isExiting
                      ? 'slide-out-down'
                      : ''}"
            >
                <button
                    class="continue-btn"
                    on:click={continueToNextStep}
                    disabled={!selectedTimeSlot}
                >
                    Continue to Review
                </button>
            </div>
        {:else if currentStep === 3}
            {#if selectedAddress}
                <div
                    class="avatar-overlay {isEntering
                        ? 'slide-in-right'
                        : isExiting
                          ? 'slide-out-right'
                          : ''}"
                >
                </div>

                <CheckoutSummary
                    {cartItems}
                    address={selectedAddress}
                    deliveryInstructions={instructions}
                    deliveryTime={selectedTimeSlot}
                    {isEntering}
                    {isExiting}
                    on:placeOrder={placeOrder}
                    on:editAddress={() => goToStep(1)}
                    on:editTime={() => goToStep(2)}
                    on:containerBound={(e) => {
                        checkoutContainer = e.detail;
                    }}
                />

                {#if checkoutError}
                    <div class="checkout-error">
                        {checkoutError}
                    </div>
                {/if}
            {:else}
                <div class="missing-info">
                    <p>
                        Missing required information. Please go back and
                        complete all steps.
                    </p>
                    <button class="back-btn" on:click={goBack}>Go Back</button>
                </div>
            {/if}
        {/if}
    </div>
</div>

<style>
    .checkout-flow {
        background: var(--background);
        height: 100%;
        display: flex;
        flex-direction: column;
    }

    .checkout-header {
        height: var(--component-header-height);
        box-sizing: border-box;
        padding: 0 var(--spacing-md);
        border-bottom: none;
        display: flex;
        align-items: center;
        position: relative;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        color: var(--button-text);
    }

    .checkout-header h2 {
        flex-grow: 1;
        text-align: center;
        margin: 0;
        font-size: var(--btn-font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--button-text);
    }

    .back-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--btn-icon-size-sm);
        height: var(--btn-icon-size-sm);
        background: rgba(255, 255, 255, 0.2);
        border: none;
        border-radius: 50%;
        cursor: pointer;
        transition: var(--btn-transition);
    }

    .back-button:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: scale(var(--hover-scale));
    }

    :global(.back-button svg) {
        color: var(--button-text);
        stroke: var(--button-text);
    }

    .steps-indicator {
        font-size: var(--font-size-sm);
        color: rgba(255, 255, 255, 0.8);
        padding: 4px var(--spacing-xs);
        background: rgba(0, 0, 0, 0.1);
        border-radius: var(--btn-border-radius);
    }

    .avatar-overlay {
        position: absolute;
        top: 14px;
        right: var(--spacing-lg);
        z-index: var(--z-index-sticky);
        display: flex;
    }


    .checkout-content {
        flex: 1;
        padding: 0;
        display: flex;
        flex-direction: column;
        position: relative;
    }

    .checkout-content.allow-scroll {
        overflow-y: auto;
        overflow-x: hidden;
    }

    .checkout-content.prevent-scroll {
        overflow: hidden;
    }

    .nav-buttons {
        padding: var(--spacing-lg);
        background: var(--background);
        border-top: var(--border-width-thin) solid var(--border);
        margin-top: auto;
    }

    .continue-btn {
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

    .continue-btn:hover:not(:disabled) {
        background: linear-gradient(
            135deg,
            var(--primary-dark),
            var(--secondary)
        );
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-medium);
    }

    .continue-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        background: var(--surface);
        color: var(--text-secondary);
        border: var(--border-width-thin) solid var(--border);
        box-shadow: none;
    }

    .checkout-error {
        margin: var(--spacing-md);
        padding: var(--spacing-sm);
        background-color: rgba(211, 47, 47, 0.1);
        color: var(--error);
        border-radius: var(--card-border-radius);
        font-size: var(--font-size-sm);
        border-left: 3px solid var(--error);
    }

    .missing-info {
        padding: var(--spacing-xxl);
        text-align: center;
        color: var(--text-primary);
    }

    .back-btn {
        padding: var(--btn-padding-md);
        background: var(--surface);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--btn-border-radius);
        margin-top: var(--spacing-md);
        cursor: pointer;
        transition: var(--btn-transition);
        color: var(--text-primary);
    }

    .back-btn:hover {
        background: var(--background);
        border-color: var(--primary);
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-subtle);
    }
</style>
