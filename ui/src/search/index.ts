/**
 * Search Index Services - Agent 1 (build & upload) workflows only
 */

import { IndexGenerationService } from './IndexGenerationService';

// Export Agent 1 services (build and upload)
export { IndexGenerationService } from './IndexGenerationService';

// Export shared services
export { ipfsService } from './IPFSService';

/**
 * AGENT 1 MAIN FUNCTION: Build complete search index and upload to IPFS
 * Complete workflow: DHT → Embeddings → HNSW → IndexedDB+IDBFS → IPFS → search_index DNA
 */
export async function buildAndPublishSearchIndex(store: any, progressCallback?: (progress: { message: string; percentage?: number }) => void): Promise<string> {
    console.log('🚀 Starting Agent 1 search index build and publish workflow...');
    
    const indexService = new IndexGenerationService(store.service.client, progressCallback);
    const ipfsCid = await indexService.generateAndUploadCompleteIndex();
    
    console.log(`🎉 Agent 1 workflow completed! Search index available at IPFS CID: ${ipfsCid}`);
    return ipfsCid;
}

/**
 * TODO: AGENT 2+ MAIN FUNCTION will be implemented here
 * Complete workflow: DHT discovery → IPFS download → Fast IDBFS import → Ready to search
 */

/**
 * Check if a search index is available from the search_index DNA
 * Used by both Agent 1 (to verify publish) and Agent 2+ (to discover)
 */
export async function checkForSearchIndex(store: any): Promise<{ available: boolean, cid?: string, productCount?: number }> {
    try {
        console.log('🔍 Checking for available search index in DHT...');
        
        const latestIndex = await store.service.client.callZome({
            role_name: "search_index",
            zome_name: "search_index", 
            fn_name: "get_latest_search_index",
            payload: null,
        });
        
        if (latestIndex?.ipfs_cid) {
            console.log(`✅ Search index found: ${latestIndex.ipfs_cid} (${latestIndex.product_count} products)`);
            return {
                available: true,
                cid: latestIndex.ipfs_cid,
                productCount: latestIndex.product_count
            };
        }
        
        console.log('❌ No search index found in DHT');
        return { available: false };
    } catch (error) {
        console.error('❌ Error checking for search index:', error);
        return { available: false };
    }
}