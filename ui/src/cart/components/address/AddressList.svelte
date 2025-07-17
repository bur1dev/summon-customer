<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { type Address } from "../../services/AddressService";
    import AddressCard from "./AddressCard.svelte";

    // Props
    export let addresses: Record<string, Address>;
    export let selectedAddressHash: string | null = null;
    export let removingAddresses: Set<string> = new Set();
    export let isEntering: boolean = false;
    export let isExiting: boolean = false;
    export let isFormClosing: boolean = false;

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Handle address selection
    function handleAddressSelect(event: CustomEvent) {
        const { addressHash, address } = event.detail;
        dispatch("select", { addressHash, address });
    }

    // Handle address deletion
    function handleAddressDelete(event: CustomEvent) {
        const { addressHash, address } = event.detail;
        dispatch("delete", { addressHash, address });
    }

    // Handle add new address
    function handleAddNew() {
        dispatch("addNew");
    }
</script>

<div class="addresses-container">
    {#if Object.keys(addresses).length === 0}
        <div class="no-addresses {isFormClosing ? 'slide-out-up' : 'slide-in-down'}">
            <p>You don't have any saved addresses.</p>
            <button
                class="add-address-btn"
                on:click={handleAddNew}
            >
                Add New Address
            </button>
        </div>
    {:else}
        <div class="address-list">
            {#each Object.entries(addresses) as [hash, address] (hash)}
                <AddressCard
                    {address}
                    addressHash={hash}
                    isSelected={selectedAddressHash === hash}
                    isRemoving={removingAddresses.has(hash)}
                    {isEntering}
                    {isExiting}
                    on:select={handleAddressSelect}
                    on:delete={handleAddressDelete}
                />
            {/each}

            {#if Object.keys(addresses).length < 3}
                <button
                    class="add-address-btn {isEntering
                        ? 'slide-in-right'
                        : isExiting
                          ? 'slide-out-right'
                          : ''}"
                    on:click={handleAddNew}
                >
                    + Add New Address
                </button>
            {:else}
                <div class="address-limit-message {isEntering
                    ? 'slide-in-right'
                    : isExiting
                      ? 'slide-out-right'
                      : ''}">
                    Maximum of 3 addresses allowed
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .addresses-container {
        padding: var(--spacing-md);
    }

    .no-addresses {
        text-align: center;
        padding: var(--spacing-xxl) 0;
    }

    .no-addresses p {
        margin-bottom: var(--spacing-lg);
        color: var(--text-secondary);
    }

    .address-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .add-address-btn {
        display: block;
        width: 100%;
        height: var(--btn-height-md);
        margin-top: var(--spacing-sm);
        background-color: var(--surface);
        border: var(--border-width-thin) dashed var(--primary);
        border-radius: var(--btn-border-radius);
        color: var(--primary);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition: var(--btn-transition);
    }

    .add-address-btn:hover {
        background-color: rgba(86, 98, 189, 0.1);
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-subtle);
    }

    .address-limit-message {
        display: block;
        width: 100%;
        height: var(--btn-height-md);
        margin-top: var(--spacing-sm);
        background-color: var(--surface);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--btn-border-radius);
        color: var(--text-secondary);
        font-weight: var(--font-weight-semibold);
        text-align: center;
        line-height: var(--btn-height-md);
        font-size: var(--font-size-sm);
    }
</style>