/**
 * Service for Agent 2+ - imports and restores search index from IPFS binary data
 * Counterpart to Agent 1's IndexGenerationService export functionality
 */
export class IndexImportService {
    private progressCallback?: (progress: { message: string; percentage?: number }) => void;

    constructor(progressCallback?: (progress: { message: string; percentage?: number }) => void) {
        this.progressCallback = progressCallback;
    }

    /**
     * AGENT 2+ WORKFLOW: Complete search index download and import
     * 1. Get latest CID from search_index DNA
     * 2. Download IPFS blob from Agent 1
     * 3. Deserialize binary format to extract IndexedDB + HNSW data
     * 4. Restore IndexedDB (products + embeddings)
     * 5. Restore HNSW file to IDBFS 
     * 6. Verify search functionality works instantly
     */
    async downloadAndImportSearchIndex(client: any): Promise<void> {
        console.log('🚀 [AGENT 2+] Starting search index download and import workflow...');
        this.updateProgress('🚀 Starting Agent 2+ workflow...', 0);

        try {
            // STEP 1: Get latest CID from DHT
            console.log('📡 [AGENT 2+ STEP 1] Getting latest search index CID from DHT...');
            this.updateProgress('📡 Getting latest CID from DHT...', 10);
            const { ipfsService } = await import('./IPFSService');
            const cid = await ipfsService.getLatestSearchIndexCID(client);
            
            if (!cid) {
                throw new Error('❌ No search index found in DHT. Agent 1 must run first.');
            }
            console.log(`✅ [AGENT 2+ STEP 1] Found latest CID: ${cid}`);

            // STEP 2: Download IPFS blob
            console.log('⬇️ [AGENT 2+ STEP 2] Downloading search index from IPFS...');
            this.updateProgress('⬇️ Downloading from IPFS...', 20);
            const blob = await ipfsService.downloadIndexedDBBlob(cid);
            console.log(`✅ [AGENT 2+ STEP 2] Downloaded blob: ${(blob.size / 1024).toFixed(1)}KB`);

            // STEP 3: Deserialize binary format
            console.log('📦 [AGENT 2+ STEP 3] Deserializing binary data...');
            this.updateProgress('📦 Deserializing binary data...', 40);
            const deserializedData = await this.deserializeBinary(blob);
            console.log(`✅ [AGENT 2+ STEP 3] Deserialized data: v${deserializedData.version}, ${deserializedData.productCount} products`);

            // STEP 4: Restore IndexedDB 
            console.log('💾 [AGENT 2+ STEP 4] Restoring IndexedDB cache...');
            this.updateProgress('💾 Restoring IndexedDB cache...', 60);
            await this.restoreIndexedDBFromData(deserializedData.indexedDB);
            console.log('✅ [AGENT 2+ STEP 4] IndexedDB cache restored');

            // STEP 5: Restore HNSW file to IDBFS
            console.log('🔍 [AGENT 2+ STEP 5] Restoring HNSW index to IDBFS...');
            this.updateProgress('🔍 Restoring HNSW index...', 80);
            await this.restoreHnswFileViaWorker(deserializedData.hnswFile, 'global_search_index.dat');
            console.log('✅ [AGENT 2+ STEP 5] HNSW index restored to IDBFS');

            // STEP 6: Verify search functionality
            console.log('✅ [AGENT 2+ STEP 6] Verifying search functionality...');
            this.updateProgress('✅ Verifying search functionality...', 95);
            await this.verifySearchFunctionality();
            console.log('✅ [AGENT 2+ STEP 6] Search functionality verified');

            this.updateProgress('🎉 Agent 2+ workflow completed successfully!', 100);
            console.log('🎉 [AGENT 2+] Import workflow finished successfully!');
            console.log(`📊 [AGENT 2+] Agent 2+ now has identical search capabilities to Agent 1`);

        } catch (error) {
            console.error('❌ [AGENT 2+] Import workflow failed:', error);
            this.updateProgress(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 0);
            throw error;
        }
    }

    /**
     * Deserialize Agent 1's pure binary format
     * Reverses IndexGenerationService.serializeBinary() process
     */
    private async deserializeBinary(blob: Blob): Promise<any> {
        const arrayBuffer = await blob.arrayBuffer();
        const view = new DataView(arrayBuffer);
        const uint8View = new Uint8Array(arrayBuffer);
        
        let offset = 0;
        
        // Read 4-byte header length
        const headerLength = view.getUint32(offset, true); // little-endian
        offset += 4;
        
        // Read header JSON
        const headerBytes = uint8View.slice(offset, offset + headerLength);
        const headerStr = new TextDecoder().decode(headerBytes);
        const header = JSON.parse(headerStr);
        offset += headerLength;
        
        // Read data JSON
        const jsonBytes = uint8View.slice(offset, offset + header.jsonLength);
        const jsonStr = new TextDecoder().decode(jsonBytes);
        const dataStructure = JSON.parse(jsonStr);
        offset += header.jsonLength;
        
        // Read ArrayBuffers and restore them in the data structure
        const buffers: ArrayBuffer[] = [];
        for (const bufferSize of header.bufferSizes) {
            const buffer = arrayBuffer.slice(offset, offset + bufferSize);
            buffers.push(buffer);
            offset += bufferSize;
        }
        
        // Restore ArrayBuffers in data structure
        const restoredData = this.restoreArrayBuffers(dataStructure, buffers);
        
        console.log(`[IndexImportService] Deserialized: ${buffers.length} ArrayBuffers, total size: ${buffers.reduce((sum, buf) => sum + buf.byteLength, 0)} bytes`);
        
        return restoredData;
    }

    /**
     * Restore ArrayBuffers in deserialized data structure
     * Reverses IndexGenerationService.extractArrayBuffers() process
     */
    private restoreArrayBuffers(data: any, buffers: ArrayBuffer[]): any {
        const restore = (obj: any): any => {
            if (obj && typeof obj === 'object' && obj.__arrayBuffer !== undefined) {
                const index = obj.__arrayBuffer;
                if (index >= 0 && index < buffers.length) {
                    return buffers[index];
                }
                console.warn(`[IndexImportService] Invalid ArrayBuffer index: ${index}`);
                return obj;
            }
            
            if (Array.isArray(obj)) {
                return obj.map(item => restore(item));
            }
            
            if (obj && typeof obj === 'object') {
                const result: any = {};
                for (const [key, value] of Object.entries(obj)) {
                    result[key] = restore(value);
                }
                return result;
            }
            
            return obj;
        };
        
        return restore(data);
    }

    /**
     * Restore IndexedDB from Agent 1's exported data
     * Recreates exact same database structure as Agent 1
     */
    private async restoreIndexedDBFromData(indexedDBData: any): Promise<void> {
        // Clear existing cache first
        const SearchCacheService = (await import('./SearchCacheService')).default;
        await SearchCacheService.clearCache();
        
        return new Promise((resolve, reject) => {
            const openRequest = indexedDB.open('product-search-cache', indexedDBData.version || 4);
            
            openRequest.onerror = () => reject(new Error('Failed to open IndexedDB for restore'));
            
            openRequest.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                // Create object store if it doesn't exist
                if (!db.objectStoreNames.contains('products')) {
                    db.createObjectStore('products', { keyPath: 'id' });
                }
            };
            
            openRequest.onsuccess = async (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                try {
                    const storeNames = Object.keys(indexedDBData.objectStores);
                    const tx = db.transaction(['products'], 'readwrite');
                    const store = tx.objectStore('products');
                    
                    // Restore all data from all stores to the 'products' store
                    for (const storeName of storeNames) {
                        const storeData = indexedDBData.objectStores[storeName];
                        if (Array.isArray(storeData)) {
                            for (const record of storeData) {
                                store.put(record);
                            }
                        }
                    }
                    
                    await new Promise<void>((resolve, reject) => {
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                    });
                    
                    db.close();
                    console.log('[IndexImportService] IndexedDB restoration completed');
                    resolve();
                    
                } catch (error) {
                    db.close();
                    reject(error);
                }
            };
        });
    }

    /**
     * Restore HNSW file via embedding service worker (preferred method)
     * Uses the worker's direct IDBFS write functionality
     */
    private async restoreHnswFileViaWorker(hnswFileData: ArrayBuffer, filename: string): Promise<void> {
        const { embeddingService } = await import('./EmbeddingService');
        
        // Ensure worker is initialized
        await embeddingService.initialize();
        
        // Convert ArrayBuffer to Uint8Array for import
        const hnswBinaryData = new Uint8Array(hnswFileData);
        
        // Use worker's import functionality
        await embeddingService.importRawHnswFileData(hnswBinaryData, filename);
        
        console.log(`[IndexImportService] HNSW file restored via worker: ${filename} (${hnswBinaryData.length} bytes)`);
    }

    /**
     * Restore HNSW file directly to IDBFS database (fallback method)
     * Writes raw binary data where hnswlib-wasm expects to find it
     */
    private async restoreHnswFileToIDBFS(hnswFileData: ArrayBuffer, filename: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const openRequest = indexedDB.open('/hnswlib-index');
            
            openRequest.onerror = () => reject(new Error('Failed to open IDBFS database'));
            
            openRequest.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                // Create FILE_DATA object store if it doesn't exist
                if (!db.objectStoreNames.contains('FILE_DATA')) {
                    db.createObjectStore('FILE_DATA');
                }
            };
            
            openRequest.onsuccess = async (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                try {
                    // Determine the correct store name
                    let storeNames = Array.from(db.objectStoreNames);
                    let storeName = storeNames.includes('FILE_DATA') ? 'FILE_DATA' : storeNames[0];
                    
                    if (!storeName) {
                        // Create FILE_DATA store if no stores exist
                        db.close();
                        const upgradeRequest = indexedDB.open('/hnswlib-index', db.version + 1);
                        upgradeRequest.onupgradeneeded = (e) => {
                            const upgradeDb = (e.target as IDBOpenDBRequest).result;
                            upgradeDb.createObjectStore('FILE_DATA');
                        };
                        await new Promise((resolve, reject) => {
                            upgradeRequest.onsuccess = () => resolve(upgradeRequest.result);
                            upgradeRequest.onerror = () => reject(upgradeRequest.error);
                        });
                        return this.restoreHnswFileToIDBFS(hnswFileData, filename);
                    }
                    
                    const tx = db.transaction([storeName], 'readwrite');
                    const store = tx.objectStore(storeName);
                    
                    const fullPath = `/hnswlib-index/${filename}`;
                    
                    // Create file record matching IDBFS format
                    const fileRecord = {
                        contents: new Uint8Array(hnswFileData),
                        mode: 33188, // Regular file mode
                        timestamp: Date.now()
                    };
                    
                    const putRequest = store.put(fileRecord, fullPath);
                    
                    await new Promise<void>((resolve, reject) => {
                        putRequest.onsuccess = () => resolve();
                        putRequest.onerror = () => reject(putRequest.error);
                    });
                    
                    await new Promise<void>((resolve, reject) => {
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                    });
                    
                    db.close();
                    console.log(`[IndexImportService] HNSW file restored to IDBFS: ${fullPath} (${hnswFileData.byteLength} bytes)`);
                    resolve();
                    
                } catch (error) {
                    db.close();
                    reject(error);
                }
            };
        });
    }

    /**
     * Verify that search functionality works after import
     * Should detect pre-built index and achieve instant search
     */
    private async verifySearchFunctionality(): Promise<void> {
        try {
            const SearchCacheService = (await import('./SearchCacheService')).default;
            const { embeddingService } = await import('./EmbeddingService');
            
            // Test IndexedDB restoration - should find cached products
            const dummyStore = { 
                service: { 
                    client: {
                        callZome: async () => ({}),
                        appInfo: async () => ({}),
                        myPubKey: null
                    }
                }
            };
            const products = await SearchCacheService.getSearchIndex(dummyStore, false);
            
            if (products.length === 0) {
                throw new Error('IndexedDB restoration failed - no products found');
            }
            
            console.log(`[IndexImportService] IndexedDB verification: ${products.length} products loaded`);
            
            // Test HNSW functionality - should detect pre-built index
            await embeddingService.initialize();
            
            // This should load the pre-built index from IDBFS
            // Convert ProcessedProduct to Product format for prepareHnswIndex
            const productsForHnsw = products.map(p => ({
                ...p,
                category: p.category || undefined,
                subcategory: p.subcategory || undefined,
                product_type: p.product_type || undefined,
                brand: p.brand || undefined
            }));
            await embeddingService.prepareHnswIndex(productsForHnsw, false, true, 'global_search_index.dat');
            
            // Test actual search performance
            const testQuery = 'apple banana';
            const { embeddingService: es } = await import('./EmbeddingService');
            const queryEmbedding = await es.getQueryEmbedding(testQuery);
            
            if (!queryEmbedding) {
                throw new Error('Failed to generate test query embedding');
            }
            
            const startTime = performance.now();
            const results = await es.rankBySimilarityHNSW(queryEmbedding, 10);
            const searchTime = performance.now() - startTime;
            
            if (results.length === 0) {
                throw new Error('HNSW search returned no results');
            }
            
            console.log(`[IndexImportService] HNSW verification: Found ${results.length} results in ${searchTime.toFixed(2)}ms`);
            
            if (searchTime > 50) {
                console.warn(`[IndexImportService] Search time ${searchTime.toFixed(2)}ms is slower than expected (>50ms). Index may not be pre-built.`);
            }
            
            console.log('✅ [IndexImportService] Search functionality verification successful - Agent 2+ ready for instant search!');
            
        } catch (error) {
            console.error('[IndexImportService] Search functionality verification failed:', error);
            throw new Error(`Search verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Helper method to update progress
     */
    private updateProgress(message: string, percentage?: number): void {
        console.log(`[IndexImportService] ${message}`);
        if (this.progressCallback) {
            this.progressCallback({ message, percentage });
        }
    }
}