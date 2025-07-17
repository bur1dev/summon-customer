<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from "svelte";
    import { Check, ChevronDown } from "lucide-svelte";

    export let type: "sort" | "brands" | "organic" = "sort";
    export let currentSort: string = "best";
    export let selectedBrands: Set<string> = new Set();
    export let availableBrands: string[] = [];
    export let selectedOrganic: "all" | "organic" | "non-organic" = "all"; // New prop for organic filter
    export let isOpen: boolean = false;

    const dispatch = createEventDispatcher();

    // Create a sorted version of availableBrands
    $: sortedBrands = [...availableBrands].sort((a, b) => a.localeCompare(b));

    // Local state for temporary selections
    let tempSort = currentSort;
    let tempBrands = new Set(selectedBrands);
    let tempOrganic = selectedOrganic; // New local state for organic

    // Sort options
    const sortOptions = [
        { value: "best", label: "Best Match" },
        { value: "price-asc", label: "Price: lowest first" },
        { value: "price-desc", label: "Price: highest first" },
    ];

    // Organic filter options
    interface OrganicOption {
        value: "all" | "organic" | "non-organic";
        label: string;
    }
    const organicOptions: OrganicOption[] = [
        { value: "all", label: "Show All" },
        { value: "organic", label: "Organic Only" },
        { value: "non-organic", label: "Non-Organic Only" },
    ];

    // Get button label
    $: buttonLabel =
        type === "sort"
            ? sortOptions.find((opt) => opt.value === currentSort)?.label ||
              "Sort"
            : type === "brands"
              ? selectedBrands.size > 0
                  ? `Brands (${selectedBrands.size})`
                  : "Brands"
              : type === "organic"
                ? organicOptions.find((opt) => opt.value === selectedOrganic)
                      ?.label || "Organic"
                : "Filter";

    // Check if filters are active
    $: isActive =
        type === "sort"
            ? currentSort !== "best"
            : type === "brands"
              ? selectedBrands.size > 0
              : type === "organic"
                ? selectedOrganic !== "all"
                : false;

    function handleSortChange(value: string) {
        tempSort = value;
    }

    function handleBrandToggle(brand: string) {
        if (tempBrands.has(brand)) {
            tempBrands.delete(brand);
        } else {
            tempBrands.add(brand);
        }
        tempBrands = new Set(tempBrands); // Trigger reactivity
    }

    function handleOrganicChange(value: "all" | "organic" | "non-organic") {
        tempOrganic = value;
    }

    function handleReset() {
        if (type === "sort") {
            tempSort = "best";
        } else if (type === "brands") {
            tempBrands.clear();
            tempBrands = new Set(tempBrands); // Trigger reactivity
        } else if (type === "organic") {
            tempOrganic = "all";
        }
    }

    function handleApply() {
        if (type === "sort") {
            dispatch("sortChange", tempSort);
        } else if (type === "brands") {
            dispatch("brandsChange", tempBrands);
        } else if (type === "organic") {
            dispatch("organicChange", tempOrganic);
        }
        isOpen = false;
    }

    function handleClickOutside(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest(".dropdown-container")) {
            isOpen = false;
        }
    }

    // Reset temp values when opening
    $: if (isOpen) {
        tempSort = currentSort;
        tempBrands = new Set(selectedBrands);
        tempOrganic = selectedOrganic;
    }

    onMount(() => {
        document.addEventListener("click", handleClickOutside);
    });

    onDestroy(() => {
        document.removeEventListener("click", handleClickOutside);
    });
</script>

<div class="dropdown-container">
    <button
        class="btn btn-toggle dropdown-trigger {isActive ? 'active' : ''}"
        on:click|stopPropagation={() => {
            if (!isOpen) dispatch("open");
            isOpen = !isOpen;
        }}
    >
        <span>{buttonLabel}</span>
        <ChevronDown size={16} />
    </button>

    {#if isOpen}
        <div class="dropdown-menu">
            {#if type === "sort"}
                <div class="dropdown-content">
                    {#each sortOptions as option (option.value)}
                        <label class="sort-option">
                            <input
                                type="radio"
                                name="sort"
                                value={option.value}
                                checked={tempSort === option.value}
                                on:change={() => handleSortChange(option.value)}
                            />
                            <span class="radio-custom"></span>
                            <span class="option-label">{option.label}</span>
                        </label>
                    {/each}
                </div>
            {:else if type === "brands"}
                <div class="dropdown-content brands-list">
                    {#each sortedBrands as brand (brand)}
                        <label class="brand-option">
                            <input
                                type="checkbox"
                                checked={tempBrands.has(brand)}
                                on:change={() => handleBrandToggle(brand)}
                            />
                            <span class="checkbox-custom"></span>
                            <span class="option-label">{brand}</span>
                        </label>
                    {/each}
                </div>
            {:else if type === "organic"}
                <div class="dropdown-content">
                    {#each organicOptions as option (option.value)}
                        <label class="sort-option">
                            <input
                                type="radio"
                                name="organic-filter"
                                value={option.value}
                                checked={tempOrganic === option.value}
                                on:change={() =>
                                    handleOrganicChange(option.value)}
                            />
                            <span class="radio-custom"></span>
                            <span class="option-label">{option.label}</span>
                        </label>
                    {/each}
                </div>
            {/if}

            <div class="dropdown-footer">
                <button class="btn btn-text" on:click={handleReset}
                    >Reset</button
                >
                <button class="btn btn-primary btn-sm" on:click={handleApply}
                    >Show results</button
                >
            </div>
        </div>
    {/if}
</div>

<style>
    .dropdown-container {
        position: relative;
    }

    .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 100px;
    }

    .dropdown-trigger.active {
        background: var(--text-primary);
        color: var(--button-text);
        border-color: var(--text-primary);
    }

    .dropdown-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        background: var(--surface);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--card-border-radius);
        box-shadow: var(--shadow-medium);
        min-width: 250px;
        z-index: var(--z-index-sticky); /* Lower than header */
    }

    .dropdown-content {
        padding: var(--spacing-md);
        max-height: 300px;
        overflow-y: auto;
    }

    .dropdown-content.brands-list {
        padding-bottom: 0;
    }

    .sort-option,
    .brand-option {
        display: flex;
        align-items: center;
        padding: var(--spacing-sm) 0;
        cursor: pointer;
        gap: var(--spacing-sm);
    }

    .sort-option:hover,
    .brand-option:hover {
        color: var(--primary);
    }

    .option-label {
        font-size: var(--font-size-md);
        color: var(--text-primary);
    }

    /* Radio button styling */
    .sort-option input[type="radio"] {
        display: none;
    }

    .radio-custom {
        width: 20px;
        height: 20px;
        border: 2px solid var(--border);
        border-radius: 50%;
        position: relative;
        flex-shrink: 0;
    }

    .sort-option input[type="radio"]:checked + .radio-custom {
        border-color: var(--primary);
    }

    .sort-option input[type="radio"]:checked + .radio-custom::after {
        content: "";
        width: 10px;
        height: 10px;
        background: var(--primary);
        border-radius: 50%;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
    }

    /* Checkbox styling */
    .brand-option input[type="checkbox"] {
        display: none;
    }

    .checkbox-custom {
        width: 20px;
        height: 20px;
        border: 2px solid var(--border);
        border-radius: 50%;
        position: relative;
        flex-shrink: 0;
    }

    .brand-option input[type="checkbox"]:checked + .checkbox-custom {
        border-color: var(--primary);
    }

    .brand-option input[type="checkbox"]:checked + .checkbox-custom::after {
        content: "";
        width: 10px;
        height: 10px;
        background: var(--primary);
        border-radius: 50%;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
    }

    .dropdown-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-md);
        border-top: var(--border-width-thin) solid var(--border-lighter);
    }

    /* Custom scrollbar for brands list */
    .brands-list::-webkit-scrollbar {
        width: 6px;
    }

    .brands-list::-webkit-scrollbar-track {
        background: var(--scrollbar-track);
    }

    .brands-list::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 3px;
    }

    .brands-list::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-thumb-hover);
    }
</style>
