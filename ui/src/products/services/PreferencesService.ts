import { writable } from 'svelte/store';
import type { CellId } from '@holochain/client';
import { encodeHashToBase64 } from '@holochain/client';

interface PreferenceState {
    loading: boolean;
    preference: any | null;
}

type PreferencesMap = Record<string, PreferenceState>;

export const preferences = writable<PreferencesMap>({});

let client: any = null;
let preferencesCloneCellId: CellId | null = null;

export function setPreferencesClient(holochainClient: any): void {
    client = holochainClient;
}

async function ensurePreferencesCloneExists(): Promise<boolean> {
    if (!client) return false;
    if (preferencesCloneCellId) return true;

    try {
        const agentPubKey = client.myPubKey;
        const agentPubKeyB64 = encodeHashToBase64(agentPubKey);
        
        const appInfo = await client.appInfo();
        const preferencesClones = appInfo.cell_info["preferences_role"]
            ?.filter((cell: any) => cell.type === "cloned") || [];

        if (preferencesClones.length > 0) {
            // Use existing clone
            preferencesCloneCellId = preferencesClones[0].value.cell_id;
            console.log("Clone DNA Hash:", encodeHashToBase64(preferencesCloneCellId![0]));
        } else {
            // Create new clone
            const clonedCell = await client.createCloneCell({
                modifiers: { network_seed: agentPubKeyB64 },
                name: `preferences-${agentPubKeyB64.slice(0, 8)}`,
                role_name: "preferences_role"
            });
            preferencesCloneCellId = clonedCell.cell_id;
            console.log("Clone DNA Hash:", encodeHashToBase64(preferencesCloneCellId![0]));
        }
        return true;
    } catch (error) {
        console.error("Failed to setup preferences clone:", error);
        return false;
    }
}

export function getPreferenceKey(upc: string): string {
    return `upc_${upc}`;
}

export async function loadPreference(upc: string): Promise<boolean> {
    if (!(await ensurePreferencesCloneExists())) return false;
    
    const key = getPreferenceKey(upc);
    updatePreference(key, { loading: true });
    
    try {
        const result = await client.callZome({
            cell_id: preferencesCloneCellId,
            zome_name: 'preferences',
            fn_name: 'get_preference',
            payload: { upc }
        });

        updatePreference(key, {
            loading: false,
            preference: result ? { note: result.note } : null
        });
        return true;
    } catch (error) {
        console.error("Error loading preference:", error);
        updatePreference(key, { loading: false, preference: null });
        return false;
    }
}

export async function savePreference(upc: string, note: string): Promise<boolean> {
    if (!note?.trim() || !(await ensurePreferencesCloneExists())) return false;
    
    try {
        await client.callZome({
            cell_id: preferencesCloneCellId,
            zome_name: 'preferences',
            fn_name: 'save_preference',
            payload: { upc, note: note.trim() }
        });

        updatePreference(getPreferenceKey(upc), {
            preference: { note: note.trim() }
        });
        return true;
    } catch (error) {
        console.error("Error saving preference:", error);
        return false;
    }
}

export async function deletePreference(upc: string): Promise<boolean> {
    if (!upc || !(await ensurePreferencesCloneExists())) return false;
    
    try {
        await client.callZome({
            cell_id: preferencesCloneCellId,
            zome_name: 'preferences',
            fn_name: 'delete_preference',
            payload: { upc }
        });

        updatePreference(getPreferenceKey(upc), { preference: null });
        return true;
    } catch (error) {
        console.error("Error deleting preference:", error);
        return false;
    }
}

function updatePreference(key: string, updates: Partial<PreferenceState>) {
    preferences.update(prefs => ({
        ...prefs,
        [key]: { ...prefs[key], ...updates }
    }));
}