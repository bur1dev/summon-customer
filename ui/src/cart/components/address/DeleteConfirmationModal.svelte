<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { type Address } from "../../services/AddressService";
    import { MapPin, Trash2, X } from "lucide-svelte";

    // Props
    export let isOpen: boolean = false;
    export let address: Address | null = null;
    export let isClosing: boolean = false;

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Handle overlay click
    function handleOverlayClick() {
        dispatch("cancel");
    }

    // Handle close button click
    function handleClose() {
        dispatch("cancel");
    }

    // Handle confirm deletion
    function handleConfirm() {
        dispatch("confirm");
    }

    // Handle cancel
    function handleCancel() {
        dispatch("cancel");
    }
</script>

{#if isOpen && address}
    <div
        class="modal-overlay {isClosing ? 'fade-out' : 'fade-in'}"
        on:click={handleOverlayClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirmation-title"
    >
        <div 
            class="confirmation-modal {isClosing ? 'scale-out' : 'scale-in'}"
            on:click|stopPropagation
            on:keydown|stopPropagation
            role="dialog"
        >
            <div class="confirmation-header">
                <h3 id="delete-confirmation-title">Delete Address</h3>
                <button
                    class="btn btn-icon btn-icon-sm close-btn"
                    on:click={handleClose}
                    aria-label="Close"
                >
                    <X size={16} />
                </button>
            </div>
            
            <div class="confirmation-content">
                <p>Are you sure you want to delete this address?</p>
                <div class="address-preview">
                    <div class="address-preview-icon">
                        <MapPin size={16} />
                    </div>
                    <div class="address-preview-details">
                        <div class="address-preview-label">
                            {address.label || "Address"}
                        </div>
                        <div class="address-preview-line">
                            {address.street}
                            {#if address.unit}
                                <span class="unit">{address.unit}</span>
                            {/if}
                        </div>
                        <div class="address-preview-line">
                            {address.city}, {address.state} {address.zip}
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="confirmation-actions">
                <button
                    class="btn btn-secondary"
                    on:click={handleCancel}
                >
                    Cancel
                </button>
                <button
                    class="btn btn-primary btn-danger"
                    on:click={handleConfirm}
                >
                    <Trash2 size={16} />
                    Delete Address
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* Delete Confirmation Modal - follows ProductDetailModal patterns */
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--overlay-dark);
        z-index: var(--z-index-highest);
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
        touch-action: none;
    }

    .confirmation-modal {
        background: var(--background);
        width: 90%;
        max-width: 480px;
        border-radius: var(--card-border-radius);
        box-shadow: var(--shadow-medium);
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .confirmation-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-lg) var(--spacing-lg) 0;
        border-bottom: var(--border-width-thin) solid var(--border);
        padding-bottom: var(--spacing-md);
    }

    .confirmation-header h3 {
        margin: 0;
        font-size: var(--spacing-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .close-btn {
        background: var(--surface);
        border: var(--border-width-thin) solid var(--border);
        color: var(--text-secondary);
        width: 32px;
        height: 32px;
    }

    .close-btn:hover {
        background: var(--surface-hover);
        color: var(--text-primary);
    }

    :global(.close-btn svg) {
        color: var(--text-secondary);
        stroke: var(--text-secondary);
    }

    .close-btn:hover :global(svg) {
        color: var(--text-primary);
        stroke: var(--text-primary);
    }

    .confirmation-content {
        padding: var(--spacing-lg);
    }

    .confirmation-content p {
        margin: 0 0 var(--spacing-md);
        color: var(--text-primary);
        font-size: var(--font-size-md);
    }

    .address-preview {
        display: flex;
        align-items: flex-start;
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--surface);
        border-radius: var(--btn-border-radius);
        border: var(--border-width-thin) solid var(--border);
    }

    .address-preview-icon {
        margin-right: var(--spacing-sm);
        color: var(--primary);
        flex-shrink: 0;
    }

    :global(.address-preview-icon svg) {
        color: var(--primary);
        stroke: var(--primary);
    }

    .address-preview-details {
        flex: 1;
    }

    .address-preview-label {
        font-weight: var(--font-weight-semibold);
        margin-bottom: 4px;
        color: var(--text-primary);
    }

    .address-preview-line {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        line-height: 1.4;
    }

    .unit {
        margin-left: 4px;
    }

    .confirmation-actions {
        display: flex;
        gap: var(--spacing-sm);
        padding: 0 var(--spacing-lg) var(--spacing-lg);
        justify-content: flex-end;
    }

    .btn-danger {
        background: linear-gradient(135deg, var(--error), #E91E63);
        color: var(--button-text);
        gap: var(--spacing-xs);
    }

    .btn-danger:hover {
        background: linear-gradient(135deg, #E53935, #C2185B);
        transform: translateY(var(--hover-lift));
    }

    :global(.btn-danger svg) {
        color: var(--button-text);
        stroke: var(--button-text);
    }
</style>