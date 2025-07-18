/**
 * Simple clone cache - handles Agent 1 (upload) vs Agent 2+ (browse) scenarios
 */

import type { AppClient, CellId } from "@holochain/client";
import { getActiveCloneCellId } from "./cloneHelpers";
import { startCloneSetup, updateCloneSetup, finishCloneSetup } from "../../stores/LoadingStore";

export class SimpleCloneCache {
    private cachedCellId: CellId | null = null;
    private client: AppClient;
    private backgroundManager: any = null;
    private setupInProgress: boolean = false;

    constructor(client: AppClient) {
        this.client = client;
    }

    setBackgroundManager(manager: any) {
        this.backgroundManager = manager;
    }

    /**
     * Main entry point - returns cached cell_id or sets up new clone
     */
    async getActiveCellId(): Promise<CellId> {
        // Return cached result if available
        if (this.cachedCellId) {
            console.log('📋 Using cached cell_id');
            return this.cachedCellId;
        }

        // Prevent race conditions
        if (this.setupInProgress) {
            console.log('⏳ Setup already in progress - waiting...');
            while (this.setupInProgress) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return this.getActiveCellId(); // Try again after setup completes
        }

        // Check if we need setup (first time or daily trigger)
        const needsSetup = !this.cachedCellId || 
                          (this.backgroundManager && this.backgroundManager.shouldRunDailySetup());

        if (needsSetup) {
            await this.runSetup();
        }

        // Final cache check
        if (this.cachedCellId) {
            return this.cachedCellId;
        }

        // Try to find existing clone as fallback
        try {
            const cellId = await getActiveCloneCellId(this.client);
            this.cachedCellId = cellId;
            console.log('✅ Found existing clone and cached');
            return cellId;
        } catch (error) {
            throw new Error('Clone not ready - please wait for setup to complete');
        }
    }

    /**
     * Run the complete setup process
     */
    private async runSetup(): Promise<void> {
        this.setupInProgress = true;
        
        try {
            console.log('🚀 Starting clone setup...');
            startCloneSetup('Setting up catalog access...');

            // Step 1: Wait for DHT to be ready
            await this.waitForDHT();

            // Step 2: Check directory for active catalog
            updateCloneSetup('Checking for active catalog...');
            const activeSeed = await this.getDirectoryEntry();

            if (!activeSeed) {
                // AGENT 1 SCENARIO: No directory entry = first time user
                console.log('🆕 Agent 1 scenario: No active catalog - ready for upload');
                updateCloneSetup('Ready for upload');
                finishCloneSetup();
                throw new Error('No active catalog - Agent 1 should upload data first');
            }

            // AGENT 2+ SCENARIO: Directory entry exists = setup clone
            console.log('👥 Agent 2+ scenario: Setting up clone for existing catalog');
            updateCloneSetup('Setting up clone access...');
            
            // Let background manager handle clone creation/finding
            await this.backgroundManager.setup();
            
            // Wait for data to be available
            updateCloneSetup('Waiting for data...');
            await this.waitForData();

            updateCloneSetup('Ready!');
            finishCloneSetup();

        } finally {
            this.setupInProgress = false;
        }
    }

    /**
     * Wait for DHT network to be ready
     */
    private async waitForDHT(): Promise<void> {
        let attempt = 1;
        
        while (true) {
            try {
                updateCloneSetup('Connecting to network...');
                
                await Promise.race([
                    this.client.dumpNetworkMetrics({ include_dht_summary: true }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('DHT timeout')), 10000)
                    )
                ]);
                
                console.log('✅ DHT ready!');
                updateCloneSetup('Network connected');
                return;
                
            } catch (error) {
                console.log(`❌ DHT not ready (attempt ${attempt})`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                attempt++;
            }
        }
    }

    /**
     * Get directory entry (current active catalog seed)
     */
    private async getDirectoryEntry(): Promise<string | null> {
        try {
            const seed = await this.client.callZome({
                role_name: "products_directory",
                zome_name: "products_directory", 
                fn_name: "get_active_catalog",
                payload: null
            });
            return seed || null;
        } catch (error) {
            console.log('Error checking directory:', error);
            return null;
        }
    }

    /**
     * Wait for data to be available (simple polling)
     */
    private async waitForData(): Promise<void> {
        if (!this.cachedCellId) return;

        const maxAttempts = 8; // 15 seconds max
        
        for (let i = 1; i <= maxAttempts; i++) {
            try {
                const result = await this.client.callZome({
                    cell_id: this.cachedCellId,
                    zome_name: "product_catalog",
                    fn_name: "get_all_category_products",
                    payload: "Produce"
                });
                
                if (result?.product_groups?.length > 0) {
                    console.log(`✅ Data available after ${i} attempts`);
                    return;
                }
                
                console.log(`🔄 Waiting for data (${i}/${maxAttempts})...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                console.log(`🔄 Data check ${i} failed, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.warn('⚠️ Data verification timeout - continuing anyway');
    }

    /**
     * Update cache with clone info
     */
    updateCache(cellId: CellId, seed: string) {
        this.cachedCellId = cellId;
        console.log(`📋 Cache updated for seed: ${seed.slice(0, 8)}`);
    }

    /**
     * Clear cache on errors
     */
    clearCache() {
        if (this.setupInProgress) {
            console.log('⏳ Skipping cache clear - setup in progress');
            return;
        }
        this.cachedCellId = null;
        console.log('🗑️ Cache cleared');
    }

    /**
     * Check if cache is populated
     */
    isCached(): boolean {
        return this.cachedCellId !== null;
    }
}