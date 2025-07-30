import { writable } from 'svelte/store';
import { resetFilters } from './SortingStore';

interface NavigationState {
  category: string | null;
  subcategory: string | null;
  productType: string | null;
  searchMode: boolean;
  searchQuery: string;
}

function createNavigationStore() {
  const { subscribe, set, update } = writable<NavigationState>({
    category: null,
    subcategory: null,
    productType: null,
    searchMode: false,
    searchQuery: ''
  });

  return {
    subscribe,
    navigate: (category?: string | null, subcategory?: string | null, productType?: string | null) => {
      set({
        category: category ?? null,
        subcategory: subcategory ?? null,
        productType: productType ?? null,
        searchMode: false,
        searchQuery: ''
      });
      
      // Reset filters when switching views
      resetFilters();
      
      // Simple scroll to top
      const scrollContainer = document.querySelector(".global-scroll-container");
      if (scrollContainer) scrollContainer.scrollTop = 0;
    },
    search: (query: string) => {
      update(state => ({
        ...state,
        searchMode: true,
        searchQuery: query
      }));
      
      // Simple scroll to top
      const scrollContainer = document.querySelector(".global-scroll-container");
      if (scrollContainer) scrollContainer.scrollTop = 0;
    }
  };
}

export const navigationStore = createNavigationStore();