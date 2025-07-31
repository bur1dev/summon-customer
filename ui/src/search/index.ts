/**
 * Search Index Services - Agent 1 (build & upload) and Agent 2+ (download & import) workflows
 */

import { IndexGenerationService } from './services/IndexGenerationService';
import { IndexImportService } from './services/IndexImportService';
import { SearchInitializer } from './services/SearchInitializer';

// Export Agent 1 services (build and upload)
export { IndexGenerationService } from './services/IndexGenerationService';

// Export Agent 2+ services (download and import)
export { IndexImportService } from './services/IndexImportService';

// Export auto-initialization
export { SearchInitializer } from './services/SearchInitializer';

// Export shared services
export { ipfsService } from './services/IPFSService';

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
 * AGENT 2+ MAIN FUNCTION: Download and import search index from IPFS
 * Complete workflow: DHT discovery → IPFS download → Binary deserialization → Storage restoration → Ready to search
 */
export async function downloadAndImportSearchIndex(store: any, progressCallback?: (progress: { message: string; percentage?: number }) => void): Promise<void> {
    console.log('🚀 Starting Agent 2+ search index download and import workflow...');
    
    const importService = new IndexImportService(progressCallback);
    await importService.downloadAndImportSearchIndex(store.service.client);
    
    console.log('🎉 Agent 2+ workflow completed! Search index imported and ready for instant search.');
}

/**
 * AUTO-INITIALIZATION: Smart detection and setup for both Agent 1 and Agent 2+
 * Call this on app startup to automatically handle search initialization
 */
export async function autoInitializeSearch(store: any, progressCallback?: (progress: { message: string; percentage?: number }) => void): Promise<any> {
    console.log('🔄 Auto-initializing search functionality...');
    
    const initializer = new SearchInitializer(store.service.client, progressCallback);
    const result = await initializer.autoInitialize();
    
    console.log(`🎯 Search auto-initialization completed: ${result.agent} - ${result.action} - ${result.message}`);
    return result;
}

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