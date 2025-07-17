<script lang="ts">
    import { savePreference as savePreferenceAPI, deletePreference } from "../../services/PreferencesService";
    import { updateQuantity } from "../../../cart/services/CartInteractionService";
    import { Save } from "lucide-svelte";

    // Simplified props - just need product and callbacks
    export let product: any;
    export let quantity: number;
    export let note: string;
    export let showPreferences: boolean;
    export let showButtons: boolean;
    export let noteChanged: boolean;
    export let existingPreference: any;
    export let onNoteChange: (newNote: string) => void;
    export let onShowButtonsChange: (show: boolean) => void;
    export let onNoteChangedChange: (changed: boolean) => void;
    export let onSave: (() => void) | null = null;


    async function saveProductPreference() {
        if (!note || !note.trim() || !product?.upc) return;
        await savePreferenceAPI(product.upc, note.trim());
    }

    async function deleteProductPreference() {
        if (!product?.upc) return;

        const success = await deletePreference(product.upc);
        if (success) {
            existingPreference = null;
        }
    }

    function handleNoteInput() {
        // Show save button if note changed from existing preference
        const originalNote = existingPreference?.note || "";
        const hasChanged = note !== originalNote;
        onShowButtonsChange(hasChanged);
        onNoteChangedChange(hasChanged);
    }

    async function saveInstructions() {
        try {
            // Update cart quantity (no more session notes)
            await updateQuantity(product, quantity);
            onShowButtonsChange(false);
            onNoteChangedChange(false);

            // Save or delete preference based on note content
            if (note && note.trim()) {
                await saveProductPreference();
            } else if (existingPreference) {
                // Empty note = delete preference
                await deleteProductPreference();
            }

            // Close modal after successful save
            if (onSave) {
                onSave();
            }
        } catch (error) {
            console.error("Error saving instructions:", error);
        }
    }

    function cancelPreferences() {
        onNoteChange(existingPreference?.note || "");
        onShowButtonsChange(false);
        onNoteChangedChange(false);
    }

</script>

<div class="preferences-section {showPreferences ? 'visible' : ''}">
    <h2>Your preferences</h2>
    <div class="preferences-input-row">
        <div class="input-container">
            <p class="preferences-label">Special instructions</p>
            <input
                type="text"
                bind:value={note}
                on:input={handleNoteInput}
                placeholder="I would like my shopper to..."
                class="preferences-input {noteChanged ? 'active' : ''}"
            />

            {#if existingPreference}
                <div class="saved-indicator">
                    <span class="saved-badge">
                        <Save size={12} />
                        Saved
                    </span>
                </div>
            {/if}
        </div>
        {#if showButtons}
            <div class="preferences-buttons">
                <button
                    class="cancel-button btn btn-secondary btn-md"
                    on:click={cancelPreferences}
                >
                    Cancel
                </button>
                <button
                    class="save-button btn btn-primary btn-md"
                    on:click={saveInstructions}
                >
                    Save
                </button>
            </div>
        {/if}
    </div>
</div>

<style>
    .preferences-section {
        background: var(--surface);
        border-top: var(--border-width-thin) solid var(--border);
        padding: var(--spacing-xl);
        width: 100%;
        box-sizing: border-box;
        max-height: 0;
        overflow: hidden;
        opacity: 0;
        transition:
            max-height var(--transition-normal) ease,
            opacity var(--transition-normal) ease;
    }

    .preferences-section.visible {
        max-height: 300px;
        opacity: 1;
        animation: slideInUp var(--transition-normal) ease forwards;
    }

    .preferences-input-row {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--spacing-lg);
    }

    .input-container {
        flex: 1;
        max-width: 70%;
    }

    .preferences-label {
        font-size: 15px;
        color: var(--text-primary);
        margin-bottom: var(--spacing-sm);
    }

    .preferences-input {
        width: 100%;
        height: var(--btn-height-lg);
        padding: var(--spacing-sm);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--btn-border-radius);
        font-size: 15px;
        background: var(--background);
        transition: var(--btn-transition);
        box-sizing: border-box;
    }

    .preferences-input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: var(--shadow-subtle);
    }

    .preferences-input.active {
        border-color: var(--primary);
    }

    .preferences-input::placeholder {
        color: var(--text-secondary);
    }

    .preferences-buttons {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
        height: var(--btn-height-lg);
    }

    /* Saved indicator styling */
    .saved-indicator {
        margin-top: var(--spacing-md);
    }

    .saved-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background-color: var(--success);
        color: white;
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 10px;
        margin-left: var(--spacing-sm);
        font-weight: var(--font-weight-semibold);
    }

    :global(.saved-badge svg) {
        color: white;
        stroke: white;
    }

    @media (max-width: 1024px) {
        .preferences-section {
            padding: var(--spacing-md);
        }

        .preferences-input-row {
            flex-direction: column;
            align-items: stretch;
        }

        .input-container {
            max-width: 100%;
        }

        .preferences-buttons {
            justify-content: flex-end;
            margin-top: var(--spacing-sm);
        }
    }
</style>
