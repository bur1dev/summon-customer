/**
 * SearchInitializer - Automatic Agent detection and initialization
 * Determines if this is Agent 1 (needs to build) or Agent 2+ (needs to import) and handles accordingly
 */

import { IndexImportService } from './IndexImportService';
import SearchCacheService from './SearchCacheService';
import { ipfsService } from './IPFSService';

export interface InitializationResult {
    agent: 'Agent 1' | 'Agent 2+';
    action: 'built' | 'imported' | 'ready' | 'no-action';
    productCount?: number;
    message: string;
}

export class SearchInitializer {
    private client: any;
    private progressCallback?: (progress: { message: string; percentage?: number }) => void;

    constructor(client: any, progressCallback?: (progress: { message: string; percentage?: number }) => void) {
        this.client = client;
        this.progressCallback = progressCallback;
    }

    /**
     * Automatically initialize search functionality based on current state
     * 1. Check if we already have a working search index locally
     * 2. If not, check if there's one available in DHT (Agent 2+ scenario)
     * 3. If available, download and import it automatically
     * 4. If not available, we're Agent 1 and need manual trigger to build
     */
    async autoInitialize(): Promise<InitializationResult> {
        try {
            this.updateProgress('🔍 Checking local search index...', 5);

            // Check if we already have a working local search index
            const localIndexStatus = await this.checkLocalSearchIndex();
            
            if (localIndexStatus.ready) {
                console.log('[SearchInitializer] Local search index ready, no action needed');
                return {
                    agent: 'Agent 2+',
                    action: 'ready',
                    productCount: localIndexStatus.productCount,
                    message: `Search ready with ${localIndexStatus.productCount} products`
                };
            }

            this.updateProgress('📡 Checking DHT for published search index...', 15);

            // Check if there's a search index published in DHT
            const dhtStatus = await this.checkDHTSearchIndex();
            
            if (!dhtStatus.available) {
                console.log('[SearchInitializer] No search index in DHT - Agent 1 scenario');
                return {
                    agent: 'Agent 1',
                    action: 'no-action',
                    message: 'No search index found. This is Agent 1 - manual build required.'
                };
            }

            console.log('[SearchInitializer] Search index found in DHT - Agent 2+ auto-import scenario');
            this.updateProgress('⬇️ Found search index in DHT, importing automatically...', 25);

            // We're Agent 2+ - automatically download and import
            const importService = new IndexImportService(this.progressCallback);
            await importService.downloadAndImportSearchIndex(this.client);

            console.log('[SearchInitializer] Agent 2+ auto-initialization completed');
            return {
                agent: 'Agent 2+',
                action: 'imported',
                productCount: dhtStatus.productCount,
                message: `Imported search index with ${dhtStatus.productCount} products from IPFS`
            };

        } catch (error) {
            console.error('[SearchInitializer] Auto-initialization failed:', error);
            
            // If import fails, we might still be Agent 1
            return {
                agent: 'Agent 1',
                action: 'no-action',
                message: `Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Check if we have a working local search index
     */
    private async checkLocalSearchIndex(): Promise<{ ready: boolean; productCount?: number }> {
        try {
            // Check IndexedDB cache (store parameter is unused by getSearchIndex)
            const products = await SearchCacheService.getSearchIndex(null as any, false);
            
            if (products.length === 0) {
                return { ready: false };
            }

            // Check if HNSW index is available
            const { embeddingService } = await import('./EmbeddingService');
            await embeddingService.initialize();
            
            // Quick test to see if HNSW is working
            const testEmbedding = await embeddingService.getQueryEmbedding('test');
            if (!testEmbedding) {
                return { ready: false };
            }

            // Try a quick search to verify everything works
            try {
                // Convert ProcessedProduct to Product format for prepareHnswIndex
                const productsForHnsw = products.map(p => ({
                    ...p,
                    category: p.category || undefined,
                    subcategory: p.subcategory || undefined,
                    product_type: p.product_type || undefined,
                    brand: p.brand || undefined
                }));
                await embeddingService.prepareHnswIndex(productsForHnsw, false, true, 'global_search_index.dat');
                const results = await embeddingService.rankBySimilarityHNSW(testEmbedding, 5);
                
                if (results.length > 0) {
                    console.log(`[SearchInitializer] Local search index verified: ${products.length} products, search working`);
                    return { ready: true, productCount: products.length };
                }
            } catch (searchError) {
                console.log('[SearchInitializer] Local search index exists but not working properly');
                return { ready: false };
            }

            return { ready: false };

        } catch (error) {
            console.log('[SearchInitializer] No working local search index found');
            return { ready: false };
        }
    }

    /**
     * Check if there's a search index available in DHT
     */
    private async checkDHTSearchIndex(): Promise<{ available: boolean; cid?: string; productCount?: number }> {
        try {
            const cid = await ipfsService.getLatestSearchIndexCID(this.client);
            
            if (!cid) {
                return { available: false };
            }

            // Get the latest index details
            const latestIndex = await this.client.callZome({
                role_name: "search_index",
                zome_name: "search_index", 
                fn_name: "get_latest_search_index",
                payload: null
            });

            if (latestIndex) {
                return {
                    available: true,
                    cid: latestIndex.ipfs_cid,
                    productCount: latestIndex.product_count
                };
            }

            return { available: true, cid };

        } catch (error) {
            console.error('[SearchInitializer] Error checking DHT:', error);
            return { available: false };
        }
    }

    /**
     * Helper method to update progress
     */
    private updateProgress(message: string, percentage?: number): void {
        console.log(`[SearchInitializer] ${message}`);
        if (this.progressCallback) {
            this.progressCallback({ message, percentage });
        }
    }
}