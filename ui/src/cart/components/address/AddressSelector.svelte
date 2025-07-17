<script lang="ts">
    import { onMount, createEventDispatcher } from "svelte";
    import { type Address, addresses, loadAddresses, createAddress, deleteAddress, validateAddress } from "../../services/AddressService";
    import { selectedCartAddress, selectedCartAddressHash, setDeliveryAddress, updateDeliveryAddress } from "../../services/AddressService";
    import AddressForm from "./AddressForm.svelte";
    import AddressList from "./AddressList.svelte";
    import DeleteConfirmationModal from "./DeleteConfirmationModal.svelte";
    import { NotebookPen } from "lucide-svelte";
    import { getAnimationDuration, startItemRemoval } from "../../../utils/animationUtils";

    // Props - remove legacy props, use cart address system
    export let deliveryInstructions: string = "";

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Reactive assignment for current cart address selection
    $: currentSelectedHash = $selectedCartAddressHash;
    $: currentSelectedAddress = $selectedCartAddress;

    // UI state
    let showNewAddressForm = false;
    let isValidating = false;
    let validationError = "";
    export let isEntering = true;
    export let isExiting = false;
    
    // Address form animation state
    let isFormClosing = false;
    
    // Address removal animation state
    let removingAddresses = new Set<string>();

    onMount(() => {
        // Load addresses if needed
        loadAddresses();
    });

    // Handle address selection from AddressList - integrate dual address system
    async function handleAddressSelect(event: CustomEvent) {
        const { addressHash, address } = event.detail;
        
        // Handle null address (deletion case)
        if (!address) {
            console.log('🗑️ SELECTOR: Address selection cleared (deletion)');
            // Just pass through the null selection, no cart.dna calls needed
            dispatch("select", { addressHash: null, address: null });
            return;
        }
        
        console.log('📍 SELECTOR: User selected address from private collection:', `${address.street}, ${address.city}, ${address.state}`);
        
        // Check if this is the first address selection or an update
        if (currentSelectedHash) {
            console.log('🔄 SELECTOR: Updating existing cart address selection');
            // Update existing address in cart
            const result = await updateDeliveryAddress(currentSelectedHash, address);
            if (result.success) {
                // Update the selected hash to the profiles hash for UI selection state
                selectedCartAddressHash.set(addressHash);
                dispatch("select", { addressHash, address });
            }
        } else {
            console.log('🆕 SELECTOR: First-time cart address selection');
            // Set address for the first time in cart
            const result = await setDeliveryAddress(address);
            if (result.success) {
                // Update the selected hash to the profiles hash for UI selection state
                selectedCartAddressHash.set(addressHash);
                dispatch("select", { addressHash, address });
            }
        }
    }

    // Add new address
    async function handleAddAddress(event: CustomEvent) {
        isValidating = true;
        validationError = "";

        const newAddress = event.detail.address;

        // Validate the address using OpenStreetMap
        const validation = await validateAddress(newAddress);

        if (validation.valid) {
            // Update with coordinates
            newAddress.lat = validation.lat;
            newAddress.lng = validation.lng;

            // Save the address
            const result = await createAddress(newAddress);

            if (result.success && result.data?.hash) {
                // Just notify that address was created - do NOT auto-select in cart
                console.log('✅ SELECTOR: New address created in private storage only. User must manually select to add to cart.');
                // Do not dispatch select - let user manually select if they want it in cart
                // Close form with animation
                isFormClosing = true;
                setTimeout(() => {
                    showNewAddressForm = false;
                    isFormClosing = false;
                }, getAnimationDuration('normal'));
            } else {
                validationError = "Failed to save address. Please try again.";
            }
        } else {
            validationError =
                validation.message ||
                "Address validation failed. Please check your address.";
        }

        isValidating = false;
    }

    // Handle add new address from AddressList
    function handleAddNew() {
        isFormClosing = true;
        setTimeout(() => {
            showNewAddressForm = true;
            isFormClosing = false;
        }, getAnimationDuration('normal'));
    }

    // Update delivery instructions
    function handleInstructionsChange() {
        dispatch("instructionsChange", { instructions: deliveryInstructions });
    }

    // Cancel add address with animation
    function handleCancelAddAddress() {
        isFormClosing = true;
        setTimeout(() => {
            showNewAddressForm = false;
            isFormClosing = false;
            validationError = "";
        }, getAnimationDuration('normal'));
    }

    // Confirmation modal state
    let showDeleteConfirmation = false;
    let addressToDelete: Address | null = null;
    let addressHashToDelete: string | null = null;
    let isConfirmationClosing = false;
    
    // Handle delete request from AddressList
    function handleAddressDelete(event: CustomEvent) {
        const { addressHash, address } = event.detail;
        addressToDelete = address;
        addressHashToDelete = addressHash;
        showDeleteConfirmation = true;
    }

    // Handle confirmation modal cancel
    function handleDeleteCancel() {
        isConfirmationClosing = true;
        setTimeout(() => {
            showDeleteConfirmation = false;
            isConfirmationClosing = false;
            addressToDelete = null;
            addressHashToDelete = null;
        }, getAnimationDuration('normal'));
    }

    // Handle confirmation modal confirm
    async function handleDeleteConfirm() {
        if (!addressToDelete || !addressHashToDelete) {
            console.error("No address to delete");
            return;
        }

        const addressHash = addressHashToDelete;

        // Close confirmation modal first
        handleDeleteCancel();

        // Start removal animation
        removingAddresses.add(addressHash);
        removingAddresses = removingAddresses; // Trigger reactivity

        // Find the address element for animation
        const addressElement = document.querySelector(`[data-address-hash="${addressHash}"]`) as HTMLElement;
        if (addressElement) {
            await startItemRemoval(addressElement);
        }

        // Delete the address
        const result = await deleteAddress(addressHash);

        if (result.success) {
            // If deleted address was selected, clear cart selection
            if (currentSelectedHash === addressHash) {
                // Clear cart address selection - no backend call needed since address is deleted
                dispatch("select", { addressHash: null, address: null });
            }
        } else {
            // On error, remove from removal set to restore UI
            removingAddresses.delete(addressHash);
            removingAddresses = removingAddresses;
            console.error('Failed to delete address:', result.error);
        }

        // Clean up removal state
        removingAddresses.delete(addressHash);
        removingAddresses = removingAddresses;
    }
</script>

<div class="address-selector">
    <div class="address-selector-header">
        <h2
            class={isEntering
                ? "slide-in-left"
                : isExiting
                  ? "slide-out-left"
                  : ""}
        >
            Select Delivery Address
        </h2>
    </div>

    {#if showNewAddressForm}
        <div class="address-form-container {isFormClosing ? 'slide-out-up' : 'slide-in-down'}">
            <AddressForm
                on:submit={handleAddAddress}
                on:cancel={handleCancelAddAddress}
                {isValidating}
                {validationError}
            />
        </div>
    {:else}
        <AddressList
            addresses={$addresses}
            selectedAddressHash={currentSelectedHash}
            {removingAddresses}
            {isEntering}
            {isExiting}
            {isFormClosing}
            on:select={handleAddressSelect}
            on:delete={handleAddressDelete}
            on:addNew={handleAddNew}
        />

        {#if currentSelectedHash}
            <div
                class="instructions-container {isEntering
                    ? 'slide-in-left'
                    : isExiting
                      ? 'slide-out-left'
                      : ''}"
            >
                <h3>Delivery Instructions</h3>
                <textarea
                    bind:value={deliveryInstructions}
                    on:change={handleInstructionsChange}
                    placeholder="Add delivery instructions (optional)"
                    rows="3"
                ></textarea>
                <div class="instructions-info">
                    <div class="info-item">
                        <span class="info-icon">
                            <NotebookPen size={16} />
                        </span>
                        Enter gate codes, building info, or where to leave
                        the delivery
                    </div>
                </div>
            </div>
        {/if}
    {/if}
</div>

<!-- Delete Confirmation Modal -->
<DeleteConfirmationModal
    isOpen={showDeleteConfirmation}
    address={addressToDelete}
    isClosing={isConfirmationClosing}
    on:confirm={handleDeleteConfirm}
    on:cancel={handleDeleteCancel}
/>

<style>
    .address-selector {
        background: var(--background);
        border-radius: var(--card-border-radius);
        width: 100%;
    }

    .address-selector-header {
        height: var(--component-header-height); /* Explicit height */
        box-sizing: border-box; /* Include padding and border in the element's total width and height */
        padding: 0 var(--spacing-md); /* Adjust padding, left/right as needed */
        border-bottom: var(--border-width-thin) solid var(--border);
        background: var(--background);
        border-radius: var(--card-border-radius) var(--card-border-radius) 0 0;
        display: flex; /* To allow vertical alignment */
        align-items: center; /* Vertically center content */
    }

    .address-selector-header h2 {
        margin: 0;
        font-size: var(--spacing-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .address-form-container {
        overflow: hidden;
    }

    .address-form-container.slide-in-down {
        animation: slideInDown var(--transition-normal) ease-out forwards;
    }

    .address-form-container.slide-out-up {
        animation: slideOutUp var(--transition-normal) ease-in forwards;
    }

    .instructions-container {
        margin-top: var(--spacing-xl);
        padding: var(--spacing-md) var(--spacing-md) 0;
        border-top: var(--border-width-thin) solid var(--border);
    }

    .instructions-container h3 {
        font-size: var(--font-size-md);
        margin-top: 0;
        margin-bottom: var(--spacing-xs);
        color: var(--text-primary);
    }

    textarea {
        width: 100%;
        padding: var(--spacing-sm);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--btn-border-radius);
        font-size: var(--font-size-sm);
        resize: vertical;
        background: var(--background);
        color: var(--text-primary);
        transition: var(--btn-transition);
        box-sizing: border-box;
    }

    textarea:focus {
        border-color: var(--primary);
        outline: none;
        box-shadow: 0 0 0 2px rgba(86, 98, 189, 0.2);
    }

    .instructions-info {
        margin-top: var(--spacing-sm);
    }

    .info-item {
        display: flex;
        align-items: center;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
    }

    .info-icon {
        margin-right: var(--spacing-xs);
    }

    :global(.info-icon svg) {
        color: var(--text-secondary);
        stroke: var(--text-secondary);
    }
</style>
