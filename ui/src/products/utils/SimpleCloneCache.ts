/**
 * Simple clone cache with TTL to eliminate repeated directory queries
 */

import type { AppClient, CellId } from "@holochain/client";
import { getActiveCloneCellId } from "./cloneHelpers";
import { startCloneSetup, updateCloneSetup, finishCloneSetup } from "../../stores/LoadingStore";

export class SimpleCloneCache {
    private cachedCellId: CellId | null = null;
    private cachedSeed: string | null = null;
    private client: AppClient;
    private backgroundManager: any = null; // Will be set by BackgroundCloneManager
    private setupInProgress: boolean = false; // Prevent race conditions

    constructor(client: AppClient) {
        this.client = client;
    }

    setBackgroundManager(manager: any) {
        this.backgroundManager = manager;
    }

    /**
     * Get active cell_id - uses cache or throws error if not ready
     */
    async getActiveCellId(): Promise<CellId> {
        // If setup is already in progress, wait for it to complete
        if (this.setupInProgress) {
            console.log('⏳ Setup already in progress - waiting...');
            while (this.setupInProgress) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            // After setup completes, try again
            return this.getActiveCellId();
        }

        // === DHT DEBUG: Agent 2 starting catalog search ===
        try {
            const networkStats = await this.client.dumpNetworkStats();
            const networkMetrics = await this.client.dumpNetworkMetrics({ include_dht_summary: true });
            console.log('🔍 [AGENT 2] Network stats before directory query:', networkStats);
            console.log('🔍 [AGENT 2] Network metrics before directory query:', networkMetrics);
        } catch (error) {
            console.warn('DHT debug failed:', error);
        }

        // Check if we need daily setup OR if we have no cache
        const needsDailySetup = this.backgroundManager && this.backgroundManager.shouldRunDailySetup();
        const hasNoCache = !this.cachedCellId;
        
        if (needsDailySetup || hasNoCache) {
            // Lock setup to prevent race conditions
            this.setupInProgress = true;
            
            try {
                if (needsDailySetup) {
                    console.log('🕒 Daily setup needed - triggering background manager');
                    startCloneSetup('Checking for catalog updates...');
                }
                if (hasNoCache) {
                    console.log('📭 No cached clone - triggering background manager');
                    startCloneSetup('Setting up catalog access...');
                }
                
                updateCloneSetup('Preparing clone system...', 25);
                this.clearCache(); // Clear cache to force refresh
                
                updateCloneSetup('Connecting to catalog...', 50);
                await this.backgroundManager.setup();
                
                updateCloneSetup('Loading initial data...', 75);
                // Pre-load some data to prevent UI crashes
                const preloadSuccess = await this.verifyDataAvailability(0);
                if (!preloadSuccess) {
                    console.warn('⚠️ Preload failed but continuing with setup');
                }
                
                updateCloneSetup('Syncing with network...', 90);
                // Wait until we can actually see data (scalable approach)
                const dataAvailable = await this.verifyDataAvailability(15000);
                if (!dataAvailable) {
                    console.warn('⚠️ Data verification failed but continuing');
                }
                
                updateCloneSetup('Ready!', 100);
                setTimeout(() => {
                    finishCloneSetup();
                }, 500);
                
            } finally {
                // Always unlock setup, even if it fails
                this.setupInProgress = false;
            }
        }

        // Use cache if available
        if (this.cachedCellId) {
            console.log('📋 Using cached cell_id');
            return this.cachedCellId;
        }

        // Cache miss - try to find existing clone
        console.log('🔍 Cache miss - looking for existing clone');
        try {
            const cellId = await getActiveCloneCellId(this.client);
            this.cachedCellId = cellId;
            console.log('✅ Found existing clone and cached');
            return cellId;
        } catch (error) {
            console.log('⚠️ No clone available - background manager should create it');
            throw new Error('Clone not ready - please wait for background setup');
        }
    }

    /**
     * Update cache with pre-created clone (called by background manager)
     */
    updateCache(cellId: CellId, seed: string) {
        this.cachedCellId = cellId;
        this.cachedSeed = seed;
        console.log(`📋 Cache updated with clone for seed: ${seed.slice(0, 8)}`);
    }

    /**
     * Clear cache (called on zome call errors)
     */
    clearCache() {
        // Don't clear cache if setup is in progress
        if (this.setupInProgress) {
            console.log('⏳ Skipping cache clear - setup in progress');
            return;
        }
        console.log('🗑️ Cache invalidated - will fetch fresh cell_id on next call');
        this.cachedCellId = null;
    }

    /**
     * Verify data availability with optional timeout (combines preload and wait logic)
     */
    private async verifyDataAvailability(maxWaitTime = 0): Promise<boolean> {
        if (!this.cachedCellId) {
            console.log('⚠️ No cached cell_id for data verification');
            return false;
        }

        const POLL_INTERVAL = 2000;
        const startTime = Date.now();
        let attempt = 0;

        if (maxWaitTime === 0) {
            console.log('📡 Pre-loading initial data to prevent UI crashes...');
        } else {
            console.log('⏱️ Waiting for DHT data to be available...');
        }

        do {
            attempt++;
            try {
                // === DHT DEBUG: Agent 2 polling attempt ===
                if (maxWaitTime > 0) {
                    try {
                        const networkStats = await this.client.dumpNetworkStats();
                        const networkMetrics = await this.client.dumpNetworkMetrics({ include_dht_summary: true });
                        console.log(`🔍 [AGENT 2] Attempt ${attempt} - Network stats:`, networkStats);
                        console.log(`🔍 [AGENT 2] Attempt ${attempt} - Network metrics:`, networkMetrics);
                    } catch (debugError) {
                        console.warn('DHT debug failed:', debugError);
                    }
                }
                
                const result = await this.client.callZome({
                    cell_id: this.cachedCellId,
                    zome_name: "product_catalog",
                    fn_name: "get_all_category_products",
                    payload: "Produce"
                });
                
                if (maxWaitTime > 0) {
                    console.log(`🔍 Data check attempt ${attempt}:`, result);
                }
                
                const hasProducts = result?.product_groups?.length > 0;
                
                if (hasProducts) {
                    if (maxWaitTime > 0) {
                        console.log(`✅ DHT data verified after ${attempt} attempts (${Date.now() - startTime}ms)`);
                    } else {
                        console.log('✅ Initial data pre-loaded successfully: Data found');
                    }
                    return true;
                }
                
                if (maxWaitTime === 0) {
                    console.log('✅ Initial data pre-loaded successfully: No data');
                    return true; // For preload, no data is still success
                }
                
                console.log(`🔄 Attempt ${attempt}: No data yet, waiting...`);
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
                
            } catch (error) {
                if (maxWaitTime === 0) {
                    console.error('❌ Failed to pre-load initial data - this will cause UI issues:', error);
                    return false;
                } else {
                    console.log(`🔄 Attempt ${attempt}: Error checking data (${error}), retrying...`);
                    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
                }
            }
        } while (maxWaitTime > 0 && Date.now() - startTime < maxWaitTime);
        
        if (maxWaitTime > 0) {
            console.warn(`⚠️ DHT data verification timeout after ${maxWaitTime}ms`);
        }
        return false;
    }

    /**
     * Check if cache is populated
     */
    isCached(): boolean {
        return this.cachedCellId !== null;
    }
}