<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { Address } from "../../services/AddressService";

    export let initialAddress: Partial<Address> = {
        street: "",
        unit: "",
        city: "",
        state: "",
        zip: "",
        lat: 0,
        lng: 0,
        is_default: true,
        label: "Home",
    };

    export let title = "Add New Address";
    export let submitButtonText = "Save Address";
    export let isValidating = false;
    export let validationError = "";

    // Create a copy of the address to edit
    let address: Partial<Address> = { ...initialAddress };

    const dispatch = createEventDispatcher();

    function handleSubmit() {
        // Validate form
        if (!address.street) {
            validationError = "Street address is required";
            return;
        }

        if (!address.city) {
            validationError = "City is required";
            return;
        }

        if (!address.state) {
            validationError = "State is required";
            return;
        }

        if (!address.zip) {
            validationError = "ZIP code is required";
            return;
        }

        if (!/^\d{5}$/.test(address.zip)) {
            validationError = "ZIP code must be 5 digits";
            return;
        }

        // Form is valid, dispatch event
        dispatch("submit", {
            address: {
                street: address.street,
                unit: address.unit || null,
                city: address.city,
                state: address.state,
                zip: address.zip,
                lat: address.lat || 0,
                lng: address.lng || 0,
                is_default: address.is_default !== false,
                label: address.label || null,
            },
        });
    }

    function handleCancel() {
        dispatch("cancel");
    }
</script>

<div class="address-form">
    <h2>{title}</h2>

    {#if validationError}
        <div class="validation-error">
            {validationError}
        </div>
    {/if}

    <form on:submit|preventDefault={handleSubmit}>
        <div class="form-group">
            <label for="street">Street Address *</label>
            <input
                type="text"
                id="street"
                bind:value={address.street}
                placeholder="123 Main St"
                required
                disabled={isValidating}
            />
        </div>

        <div class="form-group">
            <label for="unit">Apartment/Unit</label>
            <input
                type="text"
                id="unit"
                bind:value={address.unit}
                placeholder="Apt 4B"
                disabled={isValidating}
            />
        </div>

        <div class="form-row">
            <div class="form-group">
                <label for="city">City *</label>
                <input
                    type="text"
                    id="city"
                    bind:value={address.city}
                    placeholder="San Diego"
                    required
                    disabled={isValidating}
                />
            </div>

            <div class="form-group state-zip-group">
                <div class="state-group">
                    <label for="state">State *</label>
                    <input
                        type="text"
                        id="state"
                        bind:value={address.state}
                        placeholder="CA"
                        maxlength="2"
                        required
                        disabled={isValidating}
                    />
                </div>

                <div class="zip-group">
                    <label for="zip">ZIP *</label>
                    <input
                        type="text"
                        id="zip"
                        bind:value={address.zip}
                        placeholder="92024"
                        inputmode="numeric"
                        maxlength="5"
                        required
                        disabled={isValidating}
                    />
                </div>
            </div>
        </div>

        <div class="form-group">
            <label for="label">Address Label</label>
            <select
                id="label"
                bind:value={address.label}
                disabled={isValidating}
            >
                <option value="Home">Home</option>
                <option value="Work">Work</option>
                <option value="Other">Other</option>
            </select>
        </div>

        <div class="form-group checkbox-group">
            <label>
                <input
                    type="checkbox"
                    bind:checked={address.is_default}
                    disabled={isValidating}
                />
                Set as default address
            </label>
        </div>

        <div class="form-actions">
            <button
                type="button"
                class="cancel-btn"
                on:click={handleCancel}
                disabled={isValidating}
            >
                Cancel
            </button>
            <button type="submit" class="submit-btn" disabled={isValidating}>
                {#if isValidating}
                    Validating...
                {:else}
                    {submitButtonText}
                {/if}
            </button>
        </div>
    </form>
</div>

<style>
    .address-form {
        background: var(--background);
        border-radius: var(--card-border-radius);
        padding: var(--spacing-xl);
        max-width: 500px;
        margin: 0 auto;
    }

    h2 {
        margin-top: 0;
        margin-bottom: var(--spacing-xl);
        font-size: var(--spacing-lg);
        text-align: center;
        color: var(--text-primary);
    }

    .validation-error {
        background-color: rgba(211, 47, 47, 0.1);
        color: var(--error);
        padding: var(--spacing-sm);
        border-radius: var(--btn-border-radius);
        margin-bottom: var(--spacing-md);
        font-size: var(--font-size-sm);
        border-left: 3px solid var(--error);
    }

    .form-group {
        margin-bottom: var(--spacing-md);
    }

    .form-row {
        display: flex;
        gap: var(--spacing-md);
    }

    .form-row .form-group {
        flex: 1;
    }

    label {
        display: block;
        margin-bottom: 4px;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    input,
    select {
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-sm);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--btn-border-radius);
        font-size: var(--font-size-md);
        background: var(--background);
        color: var(--text-primary);
        transition: var(--btn-transition);
        box-sizing: border-box;
    }

    input:focus,
    select:focus {
        border-color: var(--primary);
        outline: none;
        box-shadow: 0 0 0 2px rgba(86, 98, 189, 0.2);
    }

    .state-zip-group {
        display: flex;
        gap: var(--spacing-sm);
    }

    .state-group {
        width: 80px;
    }

    .zip-group {
        flex: 1;
    }

    .checkbox-group {
        display: flex;
        align-items: center;
    }

    .checkbox-group label {
        display: flex;
        align-items: center;
        margin: 0;
        font-weight: normal;
        cursor: pointer;
    }

    .checkbox-group input {
        width: auto;
        margin-right: var(--spacing-xs);
    }

    .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-xl);
    }

    button {
        padding: var(--btn-padding-md);
        border-radius: var(--btn-border-radius);
        font-size: var(--btn-font-size-md);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition: var(--btn-transition);
        height: var(--btn-height-md);
    }

    .submit-btn {
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        color: var(--button-text);
        border: none;
        box-shadow: var(--shadow-button);
    }

    .submit-btn:hover:not(:disabled) {
        background: linear-gradient(
            135deg,
            var(--primary-dark),
            var(--secondary)
        );
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-medium);
    }

    .cancel-btn {
        background: var(--surface);
        color: var(--text-primary);
        border: var(--border-width-thin) solid var(--border);
    }

    .cancel-btn:hover:not(:disabled) {
        background: var(--background);
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-subtle);
    }

    button:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        background: var(--surface);
        color: var(--text-secondary);
        border: var(--border-width-thin) solid var(--border);
        box-shadow: none;
        transform: none;
    }
</style>
