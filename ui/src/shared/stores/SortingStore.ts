import { writable, type Readable } from 'svelte/store';

interface FilterState {
    sortBy: string;
    selectedBrands: Set<string>;
    selectedOrganic: "all" | "organic" | "non-organic";
}

// Core filter state store
const _filterStore = writable<FilterState>({
    sortBy: 'best',
    selectedBrands: new Set(),
    selectedOrganic: 'all'
});

// Readonly store for subscriptions
export const filterState: Readable<FilterState> = _filterStore;

// Filter state management functions
export function setSortBy(sortBy: string): void {
    _filterStore.update(state => ({ ...state, sortBy }));
}

export function setSelectedBrands(brands: Set<string>): void {
    _filterStore.update(state => ({ ...state, selectedBrands: new Set(brands) }));
}

export function setSelectedOrganic(organic: "all" | "organic" | "non-organic"): void {
    _filterStore.update(state => ({ ...state, selectedOrganic: organic }));
}

export function resetFilters(): void {
    _filterStore.set({
        sortBy: 'best',
        selectedBrands: new Set(),
        selectedOrganic: 'all'
    });
}

// Business logic for sorting and filtering products
export function getSortedFilteredProducts(products: any[], sortBy: string, brands: Set<string>, organic: string): any[] {
    let result = [...products];

    // Apply brand filter
    if (brands.size > 0) {
        result = result.filter(
            (product: any) =>
                product.brand &&
                brands.has(product.brand.trim()),
        );
    }

    // Apply organic filter
    if (organic === "organic") {
        result = result.filter(
            (product: any) => product.is_organic === true,
        );
    } else if (organic === "non-organic") {
        result = result.filter(
            (product: any) =>
                product.is_organic === false ||
                product.is_organic === undefined,
        );
    }

    // Apply sorting
    if (sortBy === "price-asc") {
        result.sort((a: any, b: any) => (a.price || 0) - (b.price || 0));
    } else if (sortBy === "price-desc") {
        result.sort((a: any, b: any) => (b.price || 0) - (a.price || 0));
    }

    return result;
}