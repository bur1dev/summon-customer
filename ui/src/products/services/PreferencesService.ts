import { writable } from 'svelte/store';
import type { CellId } from '@holochain/client';
import { encodeHashToBase64 } from '@holochain/client';

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
        await client.callZome({
            cell_id: cloneCellId,
            zome_name: 'preferences',
            fn_name: 'save_preference',
            payload: { upc, note: note.trim() }
        });

        updatePreference(`upc_${upc}`, { preference: { note: note.trim() } });
        return true;
    } catch (error) {
        return false;
    }
}

export async function deletePreference(upc: string): Promise<boolean> {
    if (!upc || !cloneCellId) return false;
    
    try {
        await client.callZome({
            cell_id: cloneCellId,
            zome_name: 'preferences',
            fn_name: 'delete_preference',
            payload: { upc }
        });

        updatePreference(`upc_${upc}`, { preference: null });
        return true;
    } catch (error) {
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

