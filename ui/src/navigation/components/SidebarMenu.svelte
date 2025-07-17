<script lang="ts">
    import { showMenuStore } from "../../stores/UiOnlyStore";
    import CategoryReportsAdmin from "../../reports/components/CategoryReportsAdmin.svelte";
    import { X, Tag, AlertTriangle } from "lucide-svelte";
    import { clickable } from "../../shared/actions/clickable";
    import { slideOutPanel } from "../../utils/animationUtils";


    let showCategoryAdmin = false;
    let isClosing = false;

    async function closeMenu() {
        isClosing = true;

        // Get the sidebar panel element for animation
        const sidebarElement = document.querySelector(
            ".sidebar-panel",
        ) as HTMLElement;

        // Use AnimationService for consistent timing
        await slideOutPanel(sidebarElement, "left");

        $showMenuStore = false;
        isClosing = false;
    }

</script>

{#if $showMenuStore}
    <!-- Overlay -->
    <div
        class="overlay {isClosing ? 'fade-out' : 'fade-in'}"
        use:clickable={closeMenu}
    />

    <!-- Sidebar Panel -->
    <div class="sidebar-panel {isClosing ? 'slide-out-left' : 'slide-in-left'}">
        <div
            class="sidebar-header {isClosing
                ? 'slide-out-up'
                : 'slide-in-down'}"
        >
            <button
                class="delete-cart-btn btn btn-icon btn-icon-primary btn-icon-sm"
                on:click={closeMenu}
            >
                <X size={20} />
            </button>
        </div>

        <div class="sidebar-content">

            <!-- Admin Section -->
            <div
                class="menu-section {isClosing
                    ? 'slide-out-left'
                    : 'slide-in-left'}"
            >
                <h3 class="section-title">Admin Tools</h3>

                <button
                    class="btn btn-menu btn-menu-gradient menu-button"
                    on:click={() => {
                        showCategoryAdmin = true;
                        closeMenu();
                    }}
                >
                    <Tag size={24} stroke-width={2} color="white" />
                    <span>Category Admin</span>
                </button>
            </div>

            <!-- Support Section -->
            <div
                class="menu-section {isClosing
                    ? 'slide-out-left'
                    : 'slide-in-left'}"
            >
                <h3 class="section-title">Support</h3>

                <a
                    href="https://github.com/bur1dev/summon/issues"
                    class="btn btn-menu menu-button"
                    target="_blank"
                    rel="noopener noreferrer"
                    on:click={closeMenu}
                >
                    <AlertTriangle size={24} stroke-width={2} />
                    <span>Report a Bug</span>
                </a>
            </div>
        </div>
    </div>
{/if}

{#if showCategoryAdmin}
    <div class="admin-overlay">
        <CategoryReportsAdmin onClose={() => (showCategoryAdmin = false)} />
    </div>
{/if}


<style>
    .overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--overlay-dark);
        z-index: 1999;
    }

    .overlay.fade-in {
        animation: fadeIn var(--transition-smooth) ease-out forwards;
    }

    .overlay.fade-out {
        animation: fadeOut var(--transition-smooth) ease-in forwards;
    }

    .sidebar-panel {
        position: fixed;
        top: 0;
        left: 0;
        width: var(--sidebar-width);
        height: 100vh;
        background: var(--background);
        box-shadow: var(--shadow-sidebar);
        z-index: 2000;
        display: flex;
        flex-direction: column;
    }

    .sidebar-panel.slide-in-left {
        animation: slideInLeft var(--transition-normal) ease-out forwards;
    }

    .sidebar-panel.slide-out-left {
        animation: slideOutLeft var(--transition-normal) ease-in forwards;
    }

    .sidebar-header {
        display: flex;
        justify-content: flex-end;
        padding: 0 var(--spacing-md);
        border-bottom: var(--border-width-thin) solid var(--border);
        height: var(--component-header-height);
        align-items: center;
    }

    :global(.delete-cart-btn svg) {
        color: var(--button-text);
        stroke: var(--button-text);
    }

    .sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-lg);
    }


    .menu-section {
        margin-bottom: var(--spacing-xxl);
    }

    .section-title {
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin-bottom: var(--spacing-sm);
    }

    .admin-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2100;
        background: var(--overlay-light);
        display: flex;
        justify-content: center;
        align-items: center;
        padding: var(--spacing-lg);
        overflow-y: auto;
    }

    /* Add consistent button styling */
    .menu-button {
        height: var(--btn-height-md);
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-md);
    }

    .menu-button span {
        flex: 1;
        text-align: left;
    }
</style>
