/**
 * Background service that periodically cleans up old clones
 */

import type { AppClient } from "@holochain/client";
import type { SimpleCloneCache } from "./SimpleCloneCache";

export class BackgroundCloneManager {
    private client: AppClient;
    private intervalId: number | null = null;
    private cache: SimpleCloneCache | null = null;
    private readonly CHECK_INTERVAL_MS = 20 * 1000; // 20 seconds
    private lastSetupTime: number = 0;

    /**
     * Extract network seed from clone (handles both dna_modifiers and modifiers)
     */
    private getCloneSeed(clone: any): string | null {
        return clone.dna_modifiers?.network_seed || clone.modifiers?.network_seed || null;
    }

    constructor(client: AppClient, cache?: SimpleCloneCache) {
        this.client = client;
        this.cache = cache || null;
    }

    setCache(cache: SimpleCloneCache) {
        this.cache = cache;
    }

    /**
     * One-time setup: Check directory, setup clone, update cache
     * Returns true when clone system is ready for use
     */
    async setup(): Promise<boolean> {
        console.log('🚀 Starting BackgroundCloneManager setup...');
        
        try {
            await this.ensureCloneReadyForSetup();
            await this.cleanupOldClones();
            
            this.lastSetupTime = Date.now();
            console.log('✅ BackgroundCloneManager setup complete - clone system ready');
            return true;
        } catch (error) {
            console.error('❌ BackgroundCloneManager setup failed:', error);
            return false;
        }
    }

    // ===== TESTING METHOD - KEEP FOR CONSOLE TESTING =====
    /**
     * Reset setup time for testing multiple scenarios
     * Used by window.resetCloneManager() - keep for testing
     */
    resetForTesting() {
        this.lastSetupTime = 0;
        if (this.cache) {
            // Force clear cache even if setup in progress
            (this.cache as any).cachedCellId = null;
            (this.cache as any).setupInProgress = false;
        }
        console.log('🧪 TESTING: Reset lastSetupTime and cache - next browse will trigger setup');
    }

    // ===== END TESTING METHODS =====

    /**
     * Check if we need to run setup again (daily after target time)
     */
    shouldRunDailySetup(): boolean {
        if (this.lastSetupTime === 0) {
            return true; // Never run before
        }

        const now = new Date();
        const lastSetup = new Date(this.lastSetupTime);
        
        // PRODUCTION: Check if it's after 4:00AM today 
        const todayTargetTime = new Date(now);
        todayTargetTime.setHours(4, 0, 0, 0); // 4:00 AM for production
        
        const isAfterTargetTime = now >= todayTargetTime;
        const lastSetupBeforeTargetTime = lastSetup < todayTargetTime;
        
        console.log(`🕒 Time check: Now=${now.toLocaleTimeString()}, Target=${todayTargetTime.toLocaleTimeString()}, LastSetup=${lastSetup.toLocaleTimeString()}`);
        console.log(`🕒 IsAfterTarget=${isAfterTargetTime}, LastBeforeTarget=${lastSetupBeforeTargetTime}, ShouldRun=${isAfterTargetTime && lastSetupBeforeTargetTime}`);
        
        return isAfterTargetTime && lastSetupBeforeTargetTime;
    }

    start() {
        if (this.intervalId) {
            console.log('🧹 Background clone manager already running');
            return;
        }

        console.log(`🧹 Starting background clone manager (${this.CHECK_INTERVAL_MS / 1000}s intervals)`);
        this.intervalId = setInterval(async () => {
            await this.cleanupOldClones();
        }, this.CHECK_INTERVAL_MS);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('🧹 Background clone manager stopped');
        }
    }

    private async cleanupOldClones() {
        try {
            // 1. Get current active seed from directory
            const currentSeed = await this.getCurrentSeed();
            if (!currentSeed) {
                console.log('🧹 No active catalog found, skipping cleanup');
                return;
            }

            // 2. Check if we need to pre-create clone for new seed
            await this.ensureCloneReady(currentSeed);

            // 3. Get all our local clones
            const appInfo = await this.client.appInfo();
            if (!appInfo || !appInfo.cell_info) {
                console.log('🧹 No app info available, skipping cleanup');
                return;
            }

            const allMyClones = appInfo.cell_info["products_role"]
                ?.filter(cell => cell.type === "cloned") || [];

            console.log(`🧹 Checking ${allMyClones.length} local clones against active seed: ${currentSeed.slice(0, 8)}`);

            // 4. Disable clones that don't match current seed
            let disabledCount = 0;
            for (const clone of allMyClones) {
                if (clone.type === "cloned") {
                    const cloneSeed = this.getCloneSeed(clone.value);
                    if (cloneSeed && cloneSeed !== currentSeed) {
                        try {
                            await this.client.disableCloneCell({
                                clone_cell_id: { type: "dna_hash", value: clone.value.cell_id[0] }
                            });
                            console.log(`🗑️ Disabled old clone: ${cloneSeed.slice(0, 8)}`);
                            disabledCount++;
                        } catch (error: any) {
                            const errorStr = error?.message || error?.toString() || '';
                            if (errorStr.includes('CloneCellNotFound') || errorStr.includes('AppError(CloneCellNotFound')) {
                                console.log(`🗑️ Clone already disabled: ${cloneSeed.slice(0, 8)}`);
                            } else {
                                console.warn(`⚠️ Failed to disable clone ${cloneSeed.slice(0, 8)}:`, errorStr);
                            }
                        }
                    }
                }
            }

            if (disabledCount === 0) {
                console.log('🧹 No old clones to disable');
            } else {
                console.log(`🧹 Cleanup complete: disabled ${disabledCount} old clones`);
            }

        } catch (error) {
            console.warn('⚠️ Background cleanup failed:', error);
        }
    }

    private async ensureCloneReadyForSetup() {
        const currentSeed = await this.getCurrentSeed();
        if (currentSeed) {
            console.log(`🔍 Found active catalog seed: ${currentSeed.slice(0, 8)}`);
            await this.ensureCloneReady(currentSeed);
        }
    }

    private async getCurrentSeed(): Promise<string | null> {
        try {
            const currentSeed = await this.client.callZome({
                role_name: "products_directory",
                zome_name: "products_directory", 
                fn_name: "get_active_catalog",
                payload: null
            });
            
            if (!currentSeed) {
                console.log('🔍 No active catalog found in directory');
                return null;
            }
            
            return currentSeed;
        } catch (error) {
            console.log('🔍 Error getting current seed:', error);
            return null;
        }
    }

    private async ensureCloneReady(currentSeed: string) {
        try {
            // Check if we already have a clone for this seed
            const appInfo = await this.client.appInfo();
            if (!appInfo || !appInfo.cell_info) return;

            const allMyClones = appInfo.cell_info["products_role"]
                ?.filter(cell => cell.type === "cloned") || [];

            const existingClone = allMyClones.find(clone => {
                if (clone.type === "cloned") {
                    const cloneSeed = this.getCloneSeed(clone.value);
                    return cloneSeed === currentSeed;
                }
                return false;
            });

            if (existingClone) {
                console.log(`🔄 Clone for seed ${currentSeed.slice(0, 8)} already exists`);
                
                // Update cache with existing clone so UI doesn't have to look it up
                if (this.cache && existingClone.type === "cloned") {
                    this.cache.updateCache(existingClone.value.cell_id, currentSeed);
                    console.log(`📋 Cache updated with existing clone for ${currentSeed.slice(0, 8)}`);
                }
                return;
            }

            // Pre-create clone for smooth UX
            console.log(`🚀 Pre-creating clone for seed ${currentSeed.slice(0, 8)} (smooth UX)`);
            const clonedCell = await this.client.createCloneCell({
                role_name: "products_role",
                modifiers: { network_seed: currentSeed },
                name: `products-${currentSeed.slice(0, 8)}`
            });
            console.log(`✅ Clone pre-created for ${currentSeed.slice(0, 8)}`);

            // Update cache with pre-created clone
            if (this.cache) {
                this.cache.updateCache(clonedCell.cell_id, currentSeed);
                console.log(`📋 Cache updated with pre-created clone`);
            }

        } catch (error: any) {
            const errorStr = error?.message || error?.toString() || '';
            if (errorStr.includes('DuplicateCellId')) {
                console.log(`🔄 Clone for ${currentSeed.slice(0, 8)} already exists (race condition)`);
            } else {
                console.warn(`⚠️ Failed to pre-create clone:`, errorStr);
            }
        }
    }
}