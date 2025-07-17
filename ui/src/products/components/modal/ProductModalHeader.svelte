<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { X, ArrowLeft } from "lucide-svelte";
    
    const dispatch = createEventDispatcher();
    
    function handleClose() {
        dispatch('close');
    }
</script>

<div class="modal-header">
    <button class="back-button btn btn-text" on:click={handleClose}>
        <ArrowLeft size={16} /> Back
    </button>
    <button
        class="close-button btn btn-icon btn-icon-primary btn-icon-sm"
        on:click={handleClose}
    >
        <X size={20} />
    </button>
</div>

<style>
    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-sm) var(--spacing-lg);
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        color: var(--button-text);
        border-bottom: var(--border-width-thin) solid rgba(255, 255, 255, 0.1);
    }

    .back-button {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        color: var(--button-text);
    }

    :global(.back-button svg) {
        color: var(--button-text);
        stroke: var(--button-text);
    }

    :global(.close-button svg) {
        color: var(--button-text);
        stroke: var(--button-text);
    }
</style>