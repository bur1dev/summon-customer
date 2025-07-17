<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { type Address } from "../../services/AddressService";
    import { MapPin, Trash2 } from "lucide-svelte";
    import { clickable } from "../../../shared/actions/clickable";

    // Props
    export let address: Address;
    export let addressHash: string;
    export let isSelected: boolean = false;
    export let isRemoving: boolean = false;
    export let isEntering: boolean = false;
    export let isExiting: boolean = false;

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Handle address selection
    function handleSelect() {
        dispatch("select", { addressHash, address });
    }

    // Handle delete button click
    function handleDelete() {
        dispatch("delete", { addressHash, address });
    }
</script>

<div
    class="address-card {isSelected ? 'selected' : ''} {isEntering ? 'slide-in-left' : isExiting ? 'slide-out-left' : ''} {isRemoving ? 'item-removing' : ''}"
    data-address-hash={addressHash}
    use:clickable={handleSelect}
>
    <div class="address-icon">
        <MapPin size={18} />
    </div>
    <div class="address-card-content">
        <div class="address-label">
            {address.label || "Address"}
            {#if address.is_default}
                <span class="default-badge">Default</span>
            {/if}
        </div>
        <div class="address-line">
            {address.street}
            {#if address.unit}
                <span class="unit">{address.unit}</span>
            {/if}
        </div>
        <div class="address-line">
            {address.city}, {address.state}
            {address.zip}
        </div>
    </div>
    <div class="address-card-actions">
        <button
            class="delete-address-btn"
            on:click|stopPropagation={handleDelete}
            disabled={isRemoving}
            title="Delete this address"
        >
            <Trash2 size={16} />
        </button>
        <div class="address-card-selector">
            <div class="radio-circle {isSelected ? 'checked' : ''}"></div>
        </div>
    </div>
</div>

<style>
    .address-card {
        display: flex;
        align-items: center;
        padding: var(--spacing-sm) var(--spacing-md);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--btn-border-radius);
        cursor: pointer;
        transition: var(--btn-transition);
        background: var(--background);
    }

    .address-card:hover {
        transform: translateY(var(--hover-lift));
        border-color: var(--primary);
        box-shadow: var(--shadow-subtle);
    }

    .address-card.selected {
        border-color: var(--primary);
        background: linear-gradient(
            135deg,
            rgba(86, 98, 189, 0.1),
            rgba(112, 70, 168, 0.1)
        );
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-medium);
    }

    .address-icon {
        margin-right: var(--spacing-sm);
        color: var(--primary);
    }

    :global(.address-icon svg) {
        color: var(--primary);
        stroke: var(--primary);
    }

    .address-card-content {
        flex: 1;
    }

    .address-label {
        font-weight: var(--font-weight-semibold);
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        color: var(--text-primary);
    }

    .default-badge {
        background: linear-gradient(
            135deg,
            rgba(86, 98, 189, 0.2),
            rgba(112, 70, 168, 0.2)
        );
        color: var(--primary);
        font-size: var(--font-size-sm);
        padding: 2px 6px;
        border-radius: var(--btn-border-radius);
        margin-left: var(--spacing-xs);
        font-weight: var(--font-weight-semibold);
    }

    .address-line {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        line-height: 1.4;
    }

    .unit {
        margin-left: 4px;
    }

    .address-card-actions {
        margin-left: var(--spacing-md);
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
    }

    .delete-address-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: var(--btn-border-radius);
        background: transparent;
        color: var(--error);
        cursor: pointer;
        transition: var(--btn-transition);
        opacity: 0.7;
    }

    .delete-address-btn:hover:not(:disabled) {
        background: rgba(211, 47, 47, 0.1);
        opacity: 1;
        transform: scale(1.05);
    }

    .delete-address-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    :global(.delete-address-btn svg) {
        color: var(--error);
        stroke: var(--error);
    }

    .radio-circle {
        width: 20px;
        height: 20px;
        border: var(--border-width) solid var(--border);
        border-radius: 50%;
        position: relative;
        transition: var(--btn-transition);
    }

    .radio-circle.checked {
        border-color: var(--primary);
    }

    .radio-circle.checked::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
    }

    /* Address removal animation - uses existing app.css removeItem keyframe */
    .address-card.item-removing {
        animation: removeItem var(--transition-smooth) ease-out forwards;
        pointer-events: none;
        overflow: hidden;
    }
</style>