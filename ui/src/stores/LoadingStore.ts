/**
 * Global loading state for clone setup operations
 */
import { writable } from 'svelte/store';

export interface CloneSetupState {
  isLoading: boolean;
  message: string;
}

export const cloneSetupStore = writable<CloneSetupState>({
  isLoading: false,
  message: ''
});

export function startCloneSetup(message: string = 'Preparing catalog access...') {
  cloneSetupStore.set({ isLoading: true, message });
  console.log('🔄 Loading screen started:', message);
}

export function updateCloneSetup(message: string) {
  cloneSetupStore.update(state => ({ ...state, message }));
  console.log('🔄 Loading screen updated:', message);
}

export function finishCloneSetup() {
  cloneSetupStore.set({ isLoading: false, message: '' });
  console.log('✅ Loading screen finished');
}