/**
 * Simple clone management following Holochain docs pattern
 */

import type { AppClient, CellId } from "@holochain/client";

/**
 * Get active clone cell_id (finds existing or creates new for same seed)
 */
export async function getActiveCloneCellId(client: AppClient): Promise<CellId> {
    // 1. Get active seed from directory
    const activeSeed = await client.callZome({
        role_name: "products_directory",
        zome_name: "products_directory",
        fn_name: "get_active_catalog",
        payload: null
    });

    if (!activeSeed) {
        throw new Error('No active catalog found');
    }

    // 2. Find or create clone for that seed (normal Holochain behavior)
    return await findOrCreateClone(client, activeSeed);
}


/**
 * Find existing clone or optionally create new one
 */
async function findOrCreateClone(client: AppClient, seed: string, createIfMissing = true): Promise<CellId> {
    const appInfo = await client.appInfo();
    if (!appInfo) {
        throw new Error('App info not available');
    }
    
    if (createIfMissing) {
        console.log('Looking for clone with seed:', seed.slice(0, 8));
        console.log('Available clones:', appInfo.cell_info["products_role"]?.map(cell => ({
            type: cell.type,
            name: cell.type === "cloned" ? cell.value.name : "N/A",
            seed: cell.type === "cloned" ? (cell.value as any).dna_modifiers?.network_seed : "N/A"
        })));
    }
    
    const existingClone = appInfo.cell_info["products_role"]?.find(cell => 
        cell.type === "cloned" && 
        ((cell.value as any).dna_modifiers?.network_seed === seed || cell.value.name === `products-${seed.slice(0, 8)}`)
    );

    if (existingClone && existingClone.type === "cloned") {
        console.log('Found existing clone:', seed.slice(0, 8));
        return existingClone.value.cell_id;
    }

    if (!createIfMissing) {
        throw new Error(`Clone not found for seed: ${seed.slice(0, 8)}. Upload data first.`);
    }

    // Create new clone if not found
    console.log('Creating clone for seed:', seed.slice(0, 8));
    const cloned = await client.createCloneCell({
        role_name: "products_role",
        modifiers: { network_seed: seed },
        name: `products-${seed.slice(0, 8)}`
    });

    console.log('Clone created successfully');
    return cloned.cell_id;
}

/**
 * Create new clone and update directory (for uploads)
 * Returns old cell_id that should be disabled after upload
 */
export async function createAndActivateClone(client: AppClient): Promise<{ cellId: CellId, seed: string, previousCellId: CellId | null }> {
    // Step 1: Get current active clone before creating new one
    let previousCellId: CellId | null = null;
    try {
        console.log('🔍 Checking for previous active clone to disable later...');
        previousCellId = await getActiveCloneCellId(client);
        console.log('📋 Found previous clone to disable after upload:', previousCellId[0].slice(0, 8) + '...');
    } catch (error) {
        console.log('ℹ️ No previous clone found (first upload)');
    }

    // Step 2: Create new clone
    const newSeed = crypto.randomUUID();
    
    console.log('🆕 CREATING NEW CLONE FOR UPLOAD');
    console.log('🆔 New clone seed:', newSeed.slice(0, 8));
    
    const cloned = await client.createCloneCell({
        role_name: "products_role",
        modifiers: { network_seed: newSeed },
        name: `products-${newSeed.slice(0, 8)}`
    });

    console.log('✅ Clone created successfully');
    console.log('📁 Updating directory to point to new clone');

    // Step 3: Update directory
    await client.callZome({
        role_name: "products_directory",
        zome_name: "products_directory",
        fn_name: "update_active_catalog",
        payload: newSeed
    });

    console.log('✅ Directory updated - all agents will now discover this clone');

    return { cellId: cloned.cell_id, seed: newSeed, previousCellId };
}

/**
 * Disable a clone cell by its cell_id
 */
export async function disableClone(client: AppClient, cellId: CellId): Promise<void> {
    if (!cellId) {
        console.log('🚫 No clone to disable');
        return;
    }

    try {
        console.log('🔄 Disabling previous clone:', cellId[0].slice(0, 8) + '...');
        await client.disableCloneCell({
            clone_cell_id: {
                type: "dna_hash",
                value: cellId[0]
            }
        });
        console.log('✅ Previous clone disabled successfully');
    } catch (error) {
        console.warn('⚠️ Failed to disable previous clone (non-critical):', error);
    }
}