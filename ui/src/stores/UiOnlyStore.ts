import { writable } from 'svelte/store';
import type { SearchMethod } from '../search/search-types';

// Pure UI state types
export type CurrentView = 'active' | 'checked-out';

// UI-only stores - these should NEVER trigger data fetching operations
// They control visual state, modal visibility, display modes, etc.

// View and navigation UI state
export const currentViewStore = writable<CurrentView>('active');
export const isCartOpenStore = writable<boolean>(false);
export const showReportDialogStore = writable<boolean>(false);
export const reportedProductStore = writable<any>(null);
export const showMenuStore = writable<boolean>(false);
export const bgUrlStore = writable<string>('');

// Display state for search results (doesn't trigger fetching, just displays results)
export const productNameStore = writable<string>('');
export const selectedProductHashStore = writable<string | null>(null);
export const searchResultsStore = writable<any[]>([]); // This holds search results for display
export const isViewAllStore = writable<boolean>(false);
export const searchMethodStore = writable<SearchMethod | undefined>(undefined); // Display state about which search method was used

// Featured subcategories for home view (static configuration, not changing state)
export const featuredSubcategories = [
    { category: 'Produce', subcategory: 'Fresh Fruits' },
    { category: 'Produce', subcategory: 'Fresh Vegetables' },
    { category: 'Dairy & Eggs', subcategory: 'Eggs' },
    { category: 'Dairy & Eggs', subcategory: 'Milk' },
    { category: 'Bakery', subcategory: 'Bread' },
    { category: 'Snacks & Candy', subcategory: 'Chocolate & Candy' },
    { category: 'Wine', subcategory: 'White Wine' },
    { category: 'Meat & Seafood', subcategory: 'Chicken' },
    { category: 'Beverages', subcategory: 'Juice' },
    { category: 'Frozen', subcategory: 'Frozen Desserts' },
    { category: 'Dairy & Eggs', subcategory: 'Yogurt' },
    { category: 'Breakfast', subcategory: null },
    { category: 'Frozen', subcategory: 'Frozen Snacks' },
    { category: 'Dairy & Eggs', subcategory: 'Cheese' },
    { category: 'Dairy & Eggs', subcategory: 'Sour Cream & Cream Cheese' }
];