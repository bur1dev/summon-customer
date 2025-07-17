/**
 * Global loading state for clone setup operations
 */
import { writable } from 'svelte/store';

export interface CloneSetupState {
  isLoading: boolean;
  message: string;
  progress: number;
}

export const cloneSetupStore = writable<CloneSetupState>({
  isLoading: false,
  message: '',
  progress: 0
});

export function startCloneSetup(message: string = 'Preparing catalog access...') {
  cloneSetupStore.set({ isLoading: true, message, progress: 0 });
  console.log('🔄 Loading screen started:', message);
}

export function updateCloneSetup(message: string, progress: number) {
  cloneSetupStore.update(state => ({ ...state, message, progress }));
  console.log('🔄 Loading screen updated:', message, `${progress}%`);
}

export function finishCloneSetup() {
  cloneSetupStore.set({ isLoading: false, message: '', progress: 100 });
  console.log('✅ Loading screen finished');
}