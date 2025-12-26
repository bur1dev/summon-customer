import { writable } from 'svelte/store';
import type { CellId } from '@holochain/client';
import { encodeHashToBase64 } from '@holochain/client';
import { getCartCloneCellId, isCartCloneReady } from '../../cart/services/CartCloneService';

interface PreferenceState {
    loading: boolean;
    preference: { note: string } | null;
}

export const preferences = writable<Record<string, PreferenceState>>({});

let client: any = null;
let cloneCellId: CellId | null = null;

export function setPreferencesClient(holochainClient: any): void {
    client = holochainClient;
}

export async function initializePreferencesClone(): Promise<void> {
    if (!client) throw new Error("Client not initialized");
    if (cloneCellId) return;

    const agentPubKeyB64 = encodeHashToBase64(client.myPubKey);
    const appInfo = await client.appInfo();
    const clones = appInfo.cell_info["preferences_role"] || [];
    
    const existingClone = clones.find((cell: any) => cell.type === "cloned");

    if (existingClone) {
        cloneCellId = existingClone.value.cell_id;
    } else {
        const clone = await client.createCloneCell({
            modifiers: { network_seed: agentPubKeyB64 },
            name: `preferences-${agentPubKeyB64.slice(0, 8)}`,
            role_name: "preferences_role"
        });
        cloneCellId = clone.cell_id;
    }
}

export async function loadPreference(upc: string): Promise<void> {
    if (!cloneCellId) return;
    
    const key = `upc_${upc}`;
    updatePreference(key, { loading: true });
    
    console.log(`📖 Loading preference for UPC ${upc} from clone: ${encodeHashToBase64(cloneCellId[0])}`);
    
    try {
        const result = await client.callZome({
            cell_id: cloneCellId,
            zome_name: 'preferences',
            fn_name: 'get_preference',
            payload: { upc }
        });

        updatePreference(key, {
            loading: false,
            preference: result ? { note: result.note } : null
        });
    } catch (error) {
        updatePreference(key, { loading: false, preference: null });
    }
}

export async function savePreference(upc: string, note: string): Promise<boolean> {
    if (!note?.trim() || !cloneCellId) return false;

    try {
        const trimmedNote = note.trim();

        // 1. Save preference to preferences.dna
        await client.callZome({
            cell_id: cloneCellId,
            zome_name: 'preferences',
            fn_name: 'save_preference',
            payload: { upc, note: trimmedNote }
        });

        updatePreference(`upc_${upc}`, { preference: { note: trimmedNote } });

        // 2. Update CartProduct in cart.dna if product is in cart
        if (isCartCloneReady()) {
            try {
                const cartCellId = getCartCloneCellId();
                await client.callZome({
                    cell_id: cartCellId,
                    zome_name: 'cart',
                    fn_name: 'update_cart_product_note',
                    payload: { upc, note: trimmedNote }
                });
                console.log(`✅ PREFERENCE: Updated CartProduct note for UPC ${upc}`);
            } catch (cartError) {
                // Product might not be in cart yet - this is fine, just log it
                console.log(`ℹ️ PREFERENCE: Product ${upc} not in cart yet (will snapshot when added)`);
            }
        }

        return true;
    } catch (error) {
        console.error('Error saving preference:', error);
        return false;
    }
}

export async function deletePreference(upc: string): Promise<boolean> {
    if (!upc || !cloneCellId) return false;

    try {
        // 1. Delete preference from preferences.dna
        await client.callZome({
            cell_id: cloneCellId,
            zome_name: 'preferences',
            fn_name: 'delete_preference',
            payload: { upc }
        });

        updatePreference(`upc_${upc}`, { preference: null });

        // 2. Update CartProduct in cart.dna to remove note
        if (isCartCloneReady()) {
            try {
                const cartCellId = getCartCloneCellId();
                await client.callZome({
                    cell_id: cartCellId,
                    zome_name: 'cart',
                    fn_name: 'update_cart_product_note',
                    payload: { upc, note: '' } // Empty note = no preference
                });
                console.log(`✅ PREFERENCE: Removed CartProduct note for UPC ${upc}`);
            } catch (cartError) {
                console.log(`ℹ️ PREFERENCE: Product ${upc} not in cart`);
            }
        }

        return true;
    } catch (error) {
        console.error('Error deleting preference:', error);
        return false;
    }
}

function updatePreference(key: string, updates: Partial<PreferenceState>) {
    preferences.update(prefs => ({
        ...prefs,
        [key]: { ...prefs[key], ...updates }
    }));
}

export function getPreferenceKey(upc: string): string {
    return `upc_${upc}`;
}

// Helper function to directly fetch preference note for cart snapshotting
export async function getPreferenceForUpc(upc: string): Promise<string | null> {
    if (!upc || !cloneCellId) return null;

    try {
        const result = await client.callZome({
            cell_id: cloneCellId,
            zome_name: 'preferences',
            fn_name: 'get_preference',
            payload: { upc }
        });

        return result?.note || null;
    } catch (error) {
        console.error('Error fetching preference for cart:', error);
        return null;
    }
}

