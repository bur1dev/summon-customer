<script lang="ts">
    import "@holochain-open-dev/profiles/dist/elements/update-profile.js";
    import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
    import { createEventDispatcher } from "svelte";

    // Dialog reference
    let dialog: any;

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Export open/close methods
    export const close = () => {
        if (dialog) dialog.hide();
    };

    export const open = () => {
        if (dialog) dialog.show();
    };

    // Handle profile updated event
    function handleProfileUpdated(event: any) {
        console.log("Profile updated:", event);
        dispatch("profile-updated", event.detail);
        close();
    }
</script>

<sl-dialog bind:this={dialog}>
    <div class="dialog-content">
        <div class="dialog-header">
            <h2>Edit Profile</h2>
        </div>
        <div class="profile-wrapper">
            <update-profile
                on:cancel-edit-profile={close}
                on:profile-updated={handleProfileUpdated}
            ></update-profile>
        </div>
    </div>
</sl-dialog>

<style>
    /* Dialog styling */
    sl-dialog::part(base) {
        --sl-panel-background-color: var(--background, #f2fffe);
        --sl-color-primary-600: var(--primary, #00cfbb);
        --sl-input-border-color: var(--border, #ccf2ee);
        --sl-input-border-color-hover: var(--primary, #00cfbb);
        --sl-input-border-color-focus: var(--primary, #00cfbb);
        --sl-input-border-radius-medium: var(--btn-border-radius, 50px);
        --sl-focus-ring-color: var(--primary, #00cfbb);
    }

    sl-dialog::part(overlay) {
        z-index: var(--z-index-overlay, 2000);
        background-color: var(--overlay-dark, rgba(0, 0, 0, 0.5));
    }

    sl-dialog::part(panel) {
        z-index: var(--z-index-highest, 9999);
        background: var(--background, #f2fffe);
        border-radius: var(--card-border-radius, 12px);
        max-width: 500px;
        width: 100%;
        border: var(--border-width-thin, 1px) solid var(--border, #ccf2ee);
        box-shadow: var(--shadow-medium, 0 4px 12px rgba(0, 0, 0, 0.15));
        padding: var(--spacing-xl, 24px);
    }

    sl-dialog::part(close-button) {
        color: var(--text-secondary, #5a7a7a);
        font-size: 24px;
    }

    sl-dialog::part(close-button):hover {
        color: var(--text-primary, #1e3a3a);
    }

    /* Content styling */
    .dialog-content {
        display: flex;
        flex-direction: column;
        width: 100%;
    }

    .dialog-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-bottom: var(--spacing-xl, 24px);
        padding-bottom: var(--spacing-md, 16px);
        border-bottom: var(--border-width-thin, 1px) solid var(--border-lighter, #dff8f5);
    }

    .dialog-header h2 {
        margin: 0;
        font-size: var(--font-size-lg, 20px);
        font-weight: var(--font-weight-semibold, 600);
        color: var(--text-primary, #1e3a3a);
    }

    .profile-wrapper {
        width: 100%;
    }

    /* Shoelace component styling */
    :global(update-profile) {
        --sl-input-height-medium: var(--btn-height-md, 50px);
        --sl-input-color: var(--text-primary, #1e3a3a);
        --sl-input-placeholder-color: var(--text-secondary, #5a7a7a);
        --sl-input-background-color: var(--surface, #ffffff);
        --sl-input-border-color: var(--border, #ccf2ee);
        --sl-input-border-color-hover: var(--primary, #00cfbb);
        --sl-input-border-color-focus: var(--primary, #00cfbb);
        --sl-input-border-radius-medium: var(--btn-border-radius, 50px);
        --sl-focus-ring-color: var(--primary, #00cfbb);

        --sl-button-font-size-medium: var(--font-size-md, 16px);
        --sl-button-height-medium: var(--btn-height-md, 50px);
        --sl-button-border-radius-medium: var(--btn-border-radius, 50px);
        --sl-button-font-weight-medium: var(--font-weight-semibold, 600);

        --sl-color-primary-500: var(--primary, #00cfbb) !important;
        --sl-color-primary-600: var(--primary-dark, #00b3a1) !important;
        --sl-color-primary-text: var(--button-text, #ffffff) !important;

        --sl-color-neutral-0: var(--surface, #ffffff) !important;
        --sl-color-neutral-400: var(--border, #ccf2ee) !important;
        --sl-color-neutral-700: var(--text-primary, #1e3a3a) !important;
    }
</style>