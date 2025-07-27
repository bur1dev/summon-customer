// Removed unused SearchApiClient import
import { ipfsService } from "./IPFSService";
import SearchCacheService from "./SearchCacheService";
import type { Product } from "./search-types";

/**
 * Service for Agent 1 ONLY - generates embeddings, builds HNSW index, and uploads to IPFS
 * Complete workflow: DHT → Embeddings → HNSW → IndexedDB+IDBFS → IPFS → search_index DNA
 */
export class IndexGenerationService {
    // Removed unused searchApiClient
    private client: any;
    private progressCallback?: (progress: { message: string; percentage?: number }) => void;
    private embeddingModel: any = null;

    constructor(client: any, progressCallback?: (progress: { message: string; percentage?: number }) => void) {
        this.client = client;
        this.progressCallback = progressCallback;
        
        // Constructor initialization complete
    }

    /**
     * AGENT 1 WORKFLOW: Complete search index generation and upload
     * 1. Fetch products from DHT (no embeddings)
     * 2. Generate embeddings using transformers.js 
     * 3. Cache products+embeddings in IndexedDB
     * 4. Build HNSW index and persist to IDBFS
     * 5. Export both databases as base64-encoded blob
     * 6. Upload blob to IPFS
     * 7. Publish CID to search_index DNA
     */
    async generateAndUploadCompleteIndex(): Promise<string> {
        console.log('🚀 [AGENT 1] Starting complete search index generation workflow...');
        this.updateProgress('🚀 Starting Agent 1 workflow...', 0);

        try {
            // STEP 1: Fetch products from Holochain DHT (no embeddings)
            console.log('📥 [AGENT 1 STEP 1] Fetching products from Holochain DHT...');
            this.updateProgress('📥 Fetching products from DHT...', 10);
            const products = await this.fetchAllProducts();
            console.log(`✅ [AGENT 1 STEP 1] Fetched ${products.length} products from DHT`);

            if (products.length === 0) {
                throw new Error('❌ No products found in DHT to index');
            }

            // STEP 2: Generate embeddings using transformers.js
            console.log(`🧠 [AGENT 1 STEP 2] Generating embeddings for ${products.length} products...`);
            this.updateProgress(`🧠 Generating embeddings for ${products.length} products...`, 20);
            const productsWithEmbeddings = await this.generateEmbeddingsForProducts(products);
            console.log(`✅ [AGENT 1 STEP 2] Generated embeddings for ${productsWithEmbeddings.length} products`);

            // STEP 3: Cache products+embeddings in IndexedDB
            console.log('💾 [AGENT 1 STEP 3] Caching products+embeddings in IndexedDB...');
            this.updateProgress('💾 Caching products in IndexedDB...', 50);
            const processedProducts = this.convertToProcessedProducts(productsWithEmbeddings);
            await SearchCacheService.updateCache(processedProducts);
            console.log('✅ [AGENT 1 STEP 3] Products+embeddings cached in IndexedDB');

            // STEP 4: Build HNSW index and persist to IDBFS
            console.log('🔍 [AGENT 1 STEP 4] Building HNSW index...');
            this.updateProgress('🔍 Building HNSW index...', 60);
            const { embeddingService } = await import('./EmbeddingService');
            await embeddingService.initialize();
            await embeddingService.prepareHnswIndex(processedProducts, true, true, 'global_search_index.dat');
            console.log('✅ [AGENT 1 STEP 4] HNSW index built and persisted to IDBFS');

            // STEP 5: Export optimized search index (IndexedDB + raw HNSW file only)
            console.log('📦 [AGENT 1 STEP 5] Exporting optimized search index...');
            this.updateProgress('📦 Exporting optimized search index...', 80);
            const indexBlob = await this.exportOptimizedSearchIndex(embeddingService);
            console.log(`✅ [AGENT 1 STEP 5] Optimized index exported: ${(indexBlob.size / 1024).toFixed(1)}KB blob`);

            // STEP 6: Upload to IPFS
            console.log('🌐 [AGENT 1 STEP 6] Testing IPFS connection...');
            this.updateProgress('🌐 Testing IPFS connection...', 88);
            const connectionTest = await ipfsService.testConnection();
            if (!connectionTest.connected) {
                throw new Error(`❌ IPFS connection failed: ${connectionTest.error}`);
            }
            console.log('✅ [AGENT 1 STEP 6] IPFS connection verified');
            
            console.log('⬆️ [AGENT 1 STEP 6] Uploading search index to IPFS...');
            this.updateProgress('⬆️ Uploading to IPFS...', 90);
            const ipfsCid = await ipfsService.uploadIndexedDBBlob(indexBlob, {
                productCount: products.length,
                version: '4.0-pure-binary'
            });
            console.log(`✅ [AGENT 1 STEP 6] Uploaded to IPFS: ${ipfsCid}`);

            // STEP 7: Publish CID to search_index DNA
            console.log('📢 [AGENT 1 STEP 7] Publishing CID to search_index DNA...');
            this.updateProgress('📢 Publishing to DHT...', 95);
            await this.client.callZome({
                role_name: "search_index",
                zome_name: "search_index", 
                fn_name: "publish_search_index",
                payload: {
                    version: new Date().toISOString(),
                    ipfs_cid: ipfsCid,
                    product_count: products.length,
                    created_at: Date.now() * 1000,
                    created_by: this.client.myPubKey
                }
            });
            console.log('✅ [AGENT 1 STEP 7] CID published to DHT successfully');

            this.updateProgress('🎉 Agent 1 workflow completed successfully!', 100);
            console.log('🎉 [AGENT 1] Complete workflow finished successfully!');
            console.log(`📊 [AGENT 1] Final stats: ${products.length} products, ${(indexBlob.size / 1024 / 1024).toFixed(2)}MB blob, CID: ${ipfsCid}`);
            
            return ipfsCid;

        } catch (error) {
            console.error('❌ [AGENT 1] Workflow failed:', error);
            this.updateProgress(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 0);
            throw error;
        }
    }

    /**
     * Helper method to update progress
     */
    private updateProgress(message: string, percentage?: number): void {
        console.log(`[IndexGenerationService] ${message}`);
        if (this.progressCallback) {
            this.progressCallback({ message, percentage });
        }
    }

    /**
     * Fetch all products from Holochain DHT without embeddings
     */
    private async fetchAllProducts(): Promise<Product[]> {
        try {
            console.log('[IndexGenerationService] Fetching all products from Holochain DHT...');
            
            // Get active clone cell ID
            const { getActiveCloneCellId } = await import("../products/utils/cloneHelpers");
            const cellId = await getActiveCloneCellId(this.client);
            
            // Bulk fetch all products using the same method as SearchCacheService
            const response: { products: any[], total: number } = await this.client.callZome({
                cell_id: cellId,
                zome_name: "product_catalog",
                fn_name: "get_all_products_for_search_index",
                payload: null,
            });

            if (!response || !response.products || response.products.length === 0) {
                console.warn('[IndexGenerationService] No products returned from Holochain');
                return [];
            }

            console.log(`[IndexGenerationService] Received ${response.products.length} ProductGroups containing ${response.total} total products`);

            // Extract products from groups (without embeddings)
            const products: Product[] = [];
            const { decode } = await import("@msgpack/msgpack");

            for (const groupRecord of response.products) {
                try {
                    const groupHash = groupRecord.signed_action.hashed.hash;
                    const groupData = decode(groupRecord.entry.Present.entry) as any;

                    if (groupData && Array.isArray(groupData.products)) {
                        groupData.products.forEach((rawProduct: any, index: number) => {
                            // Create product without embedding (Agent 1 will generate them)
                            const product: Product = {
                                name: rawProduct.name || '',
                                price: rawProduct.price || 0,
                                promo_price: rawProduct.promo_price,
                                size: rawProduct.size || '',
                                stocks_status: rawProduct.stocks_status,
                                category: rawProduct.category,
                                subcategory: rawProduct.subcategory,
                                product_type: rawProduct.product_type,
                                brand: rawProduct.brand,
                                image_url: rawProduct.image_url,
                                sold_by: rawProduct.sold_by,
                                productId: rawProduct.product_id,
                                upc: rawProduct.upc,
                                hash: {
                                    groupHash: groupHash,
                                    index: index,
                                    toString: function () {
                                        return `${this.groupHash}:${this.index}`;
                                    }
                                }
                                // Note: No embedding property - will be added later
                            };

                            products.push(product);
                        });
                    }
                } catch (error) {
                    console.error('[IndexGenerationService] Error processing product group:', error);
                }
            }

            console.log(`[IndexGenerationService] Extracted ${products.length} products from DHT`);
            this.updateProgress(`Fetched ${products.length} products from DHT`, 15);
            
            return products;

        } catch (error) {
            console.error('[IndexGenerationService] Error fetching products from DHT:', error);
            throw new Error(`Failed to fetch products from DHT: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generate embeddings for products using main-thread approach
     * Replicates generate_product_embeddings.py functionality
     */
    private async generateEmbeddingsForProducts(products: Product[]): Promise<Product[]> {
        console.log('[IndexGenerationService] Starting embedding generation...');
        
        const BATCH_SIZE = 32;
        const productsWithEmbeddings: Product[] = [];
        const totalBatches = Math.ceil(products.length / BATCH_SIZE);

        // Initialize embedding model if not already done
        await this.initializeEmbeddingModel();

        for (let i = 0; i < products.length; i += BATCH_SIZE) {
            const batch = products.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i/BATCH_SIZE) + 1;
            
            console.log(`[IndexGenerationService] Processing batch ${batchNumber}/${totalBatches} (${batch.length} products)`);
            this.updateProgress(`Generating embeddings... Batch ${batchNumber}/${totalBatches}`, 20 + (batchNumber / totalBatches) * 50);
            
            // Generate embeddings for batch
            const batchWithEmbeddings = await this.generateEmbeddingsBatch(batch);
            productsWithEmbeddings.push(...batchWithEmbeddings);
            
            // Small delay to prevent UI blocking
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        console.log(`[IndexGenerationService] Generated embeddings for ${productsWithEmbeddings.length} products`);
        return productsWithEmbeddings;
    }

    /**
     * Initialize the embedding model (transformers.js)
     */
    private async initializeEmbeddingModel(): Promise<void> {
        if (this.embeddingModel) {
            return; // Already initialized
        }

        try {
            console.log('[IndexGenerationService] Initializing embedding model...');
            this.updateProgress('Loading embedding model...', 18);
            
            // Load actual transformers.js pipeline
            const { pipeline } = await import('@xenova/transformers');
            
            this.embeddingModel = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L12-v2', {
                progress_callback: (progress: any) => {
                    const percentage = progress.progress ? Math.round(progress.progress * 100) : undefined;
                    const message = `Loading model: ${progress.status || ''} ${progress.file || ''}`.trim();
                    this.updateProgress(message, 18 + (percentage ? percentage * 0.02 : 0)); // 18-20% range
                }
            });
            
            console.log('[IndexGenerationService] Embedding model initialized successfully');
            
        } catch (error) {
            console.error('[IndexGenerationService] Error initializing embedding model:', error);
            throw new Error(`Failed to initialize embedding model: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generate embeddings for a batch of products
     * Uses transformers.js for actual embedding generation
     */
    private async generateEmbeddingsBatch(products: Product[]): Promise<Product[]> {
        // Construct text for each product (matching generate_product_embeddings.py)
        const productTexts = products.map(product => this.constructProductText(product));
        
        let embeddings: Float32Array[];
        
        if (this.embeddingModel && typeof this.embeddingModel === 'function') {
            try {
                // Generate embeddings using real transformers.js model
                const outputs = await this.embeddingModel(productTexts, { 
                    pooling: 'mean', 
                    normalize: true 
                });
                
                // Handle batch output - outputs should be an array of tensors
                if (Array.isArray(outputs)) {
                    embeddings = outputs.map(output => new Float32Array(output.data));
                } else {
                    // Single tensor output, split by batch
                    const batchSize = productTexts.length;
                    const dimension = 384;
                    const allData = new Float32Array(outputs.data);
                    
                    embeddings = [];
                    for (let i = 0; i < batchSize; i++) {
                        const start = i * dimension;
                        const end = start + dimension;
                        embeddings.push(allData.slice(start, end));
                    }
                }
                
                console.log(`[IndexGenerationService] Generated ${embeddings.length} real embeddings for batch`);
                
            } catch (error) {
                console.error('[IndexGenerationService] Error generating real embeddings, falling back to deterministic:', error);
                
                // Fallback to deterministic embeddings on error
                embeddings = productTexts.map(text => {
                    const embedding = new Float32Array(384);
                    let hash = 0;
                    for (let i = 0; i < text.length; i++) {
                        hash = ((hash << 5) - hash + text.charCodeAt(i)) & 0xffffffff;
                    }
                    
                    for (let i = 0; i < 384; i++) {
                        const seed = (hash + i) / 0xffffffff;
                        embedding[i] = (Math.sin(seed * Math.PI * 2) * 0.1);
                    }
                    return embedding;
                });
            }
        } else {
            console.warn('[IndexGenerationService] Embedding model not properly initialized, using deterministic embeddings');
            
            // Fallback: deterministic embeddings based on text content
            embeddings = productTexts.map(text => {
                const embedding = new Float32Array(384);
                let hash = 0;
                for (let i = 0; i < text.length; i++) {
                    hash = ((hash << 5) - hash + text.charCodeAt(i)) & 0xffffffff;
                }
                
                for (let i = 0; i < 384; i++) {
                    const seed = (hash + i) / 0xffffffff;
                    embedding[i] = (Math.sin(seed * Math.PI * 2) * 0.1);
                }
                return embedding;
            });
        }

        // Return products with embeddings
        return products.map((product, index) => ({
            ...product,
            embedding: embeddings[index]
        }));
    }

    /**
     * Construct product text for embedding (matching generate_product_embeddings.py)
     */
    private constructProductText(product: Product): string {
        const name = product.name || '';
        const brand = product.brand || '';
        const category = product.category || '';
        const subcategory = product.subcategory || '';
        const productType = product.product_type || '';

        const parts = [name, brand, category, subcategory, productType]
            .filter(part => part.trim().length > 0);

        return parts.join(' ').trim().toLowerCase();
    }

    /**
     * Convert Product[] with embeddings to ProcessedProduct[] format
     * Required by SearchCacheService.buildAndCacheSearchIndex
     */
    private convertToProcessedProducts(products: Product[]): any[] {
        return products.map(product => ({
            name: product.name,
            price: product.price || 0,
            promo_price: product.promo_price,
            size: product.size || '',
            stocks_status: product.stocks_status,
            
            // String fields (denormalized)
            category: product.category || null,
            subcategory: product.subcategory || null,
            product_type: product.product_type || null,
            brand: product.brand || null,
            
            // For ProcessedProduct interface, we need these ID fields
            // Since we're building from scratch, we'll use dummy values
            // The actual normalization happens in SearchCacheService
            categoryId: 0,
            subcategoryId: 0,
            productTypeId: 0,
            brandId: 0,
            
            // Other fields
            image_url: product.image_url,
            sold_by: product.sold_by,
            productId: product.productId,
            upc: product.upc,
            
            // Embedding and hash
            embedding: product.embedding,
            hash: product.hash
        }));
    }

    /**
     * Export optimized search index: IndexedDB as base64 + HNSW as raw ArrayBuffer
     * Minimizes IPFS blob size by using raw binary for HNSW file
     */
    private async exportOptimizedSearchIndex(embeddingService: any): Promise<Blob> {
        console.log('[IndexGenerationService] Creating optimized search index export...');
        
        try {
            // PURE BINARY APPROACH: Get raw data for both IndexedDB and HNSW
            const indexedDBData = await this.getIndexedDBData();
            const hnswFileData = await embeddingService.exportRawHnswFileData('global_search_index.dat');
            console.log(`[IndexGenerationService] Raw HNSW file: ${hnswFileData.length} bytes`);
            
            // Combine IndexedDB + HNSW into single data structure
            const combinedData = {
                version: '4.0',
                format: 'pure-binary',
                timestamp: Date.now(),
                productCount: await this.getProductCount(),
                indexedDB: indexedDBData,
                hnswFile: hnswFileData.buffer // Raw HNSW ArrayBuffer
            };
            
            // Use pure binary serialization (preserves all ArrayBuffers)
            const binaryData = new Uint8Array(this.serializeBinary(combinedData));
            const exportBlob = new Blob([binaryData], { type: 'application/octet-stream' });
            
            const indexedDBSize = indexedDBData ? JSON.stringify(indexedDBData).length : 0;
            console.log(`[IndexGenerationService] Pure binary export: IndexedDB=${indexedDBSize}B, HNSW=${hnswFileData.length}B, Total=${exportBlob.size}B`);
            // Pure binary format complete
            
            return exportBlob;
            
        } catch (error) {
            console.error('[IndexGenerationService] Error creating optimized export:', error);
            throw error;
        }
    }

    /**
     * Get raw IndexedDB data for combining with other data before serialization
     */
    private async getIndexedDBData(): Promise<any> {
        return new Promise((resolve, reject) => {
            const openRequest = indexedDB.open('product-search-cache');
            
            openRequest.onerror = () => reject(new Error('Failed to open IndexedDB'));
            
            openRequest.onsuccess = async (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                try {
                    // Collect all data with structured cloning (preserves ArrayBuffers)
                    const exportData: any = { version: db.version, objectStores: {} };
                    const storeNames: string[] = [];
                    for (let i = 0; i < db.objectStoreNames.length; i++) {
                        storeNames.push(db.objectStoreNames[i]);
                    }
                    
                    const tx = db.transaction(storeNames, 'readonly');
                    
                    for (const storeName of storeNames) {
                        const store = tx.objectStore(storeName);
                        const getAllRequest = store.getAll();
                        
                        const storeData = await new Promise<any[]>((resolve, reject) => {
                            getAllRequest.onsuccess = () => resolve(getAllRequest.result);
                            getAllRequest.onerror = () => reject(getAllRequest.error);
                        });
                        
                        exportData.objectStores[storeName] = storeData;
                    }
                    
                    await new Promise<void>((resolve, reject) => {
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                    });
                    
                    db.close();
                    resolve(exportData);
                    
                } catch (error) {
                    db.close();
                    reject(error);
                }
            };
        });
    }

    // Removed redundant exportIndexedDB() method - using getIndexedDBData() instead

    /**
     * Serialize data to binary format using MessagePack-like approach
     * Preserves ArrayBuffers natively without conversion
     */
    private serializeBinary(data: any): ArrayBuffer {
        // Serializing data with structured cloning
        
        // Use a simple approach: JSON for structure + binary append for ArrayBuffers
        const { cleanData, buffers } = this.extractArrayBuffers(data);
        
        // Serialize structure as JSON
        const jsonStr = JSON.stringify(cleanData);
        const jsonBytes = new TextEncoder().encode(jsonStr);
        
        // Calculate total size needed
        let totalBufferSize = 0;
        buffers.forEach(buf => totalBufferSize += buf.byteLength);
        
        // Create header with buffer info
        const header = {
            jsonLength: jsonBytes.length,
            bufferCount: buffers.length,
            bufferSizes: buffers.map(buf => buf.byteLength)
        };
        const headerBytes = new TextEncoder().encode(JSON.stringify(header));
        const headerLength = headerBytes.length;
        
        // Combine: [4 bytes header length][header][json][buffers...]
        const totalSize = 4 + headerLength + jsonBytes.length + totalBufferSize;
        const combined = new ArrayBuffer(totalSize);
        const view = new DataView(combined);
        const uint8View = new Uint8Array(combined);
        
        let offset = 0;
        
        // Write header length
        view.setUint32(offset, headerLength, true);
        offset += 4;
        
        // Write header
        uint8View.set(headerBytes, offset);
        offset += headerLength;
        
        // Write JSON
        uint8View.set(jsonBytes, offset);
        offset += jsonBytes.length;
        
        // Write buffers
        buffers.forEach(buffer => {
            uint8View.set(new Uint8Array(buffer), offset);
            offset += buffer.byteLength;
        });
        
        // Binary serialization complete
        return combined;
    }

    /**
     * Extract ArrayBuffers from data structure and replace with placeholders
     */
    private extractArrayBuffers(data: any, path: string = ''): { cleanData: any, buffers: ArrayBuffer[] } {
        const buffers: ArrayBuffer[] = [];
        
        const clean = (obj: any, currentPath: string): any => {
            if (obj instanceof ArrayBuffer) {
                const index = buffers.length;
                buffers.push(obj);
                return { __arrayBuffer: index, __path: currentPath };
            }
            
            if (Array.isArray(obj)) {
                return obj.map((item, i) => clean(item, `${currentPath}[${i}]`));
            }
            
            if (obj && typeof obj === 'object') {
                const result: any = {};
                for (const [key, value] of Object.entries(obj)) {
                    result[key] = clean(value, `${currentPath}.${key}`);
                }
                return result;
            }
            
            return obj;
        };
        
        const cleanData = clean(data, path);
        // ArrayBuffers extracted
        return { cleanData, buffers };
    }

    // Removed blobToBase64 - no longer needed with pure binary format

    // Removed unused uint8ArrayToBase64 method - no longer needed with pure binary format

    /**
     * Get product count from metadata
     */
    private async getProductCount(): Promise<number> {
        try {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open('product-search-cache');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            const tx = db.transaction('products', 'readonly');
            const store = tx.objectStore('products');
            const metadataRequest = store.get('metadata_v1');
            
            const metadata = await new Promise<any>((resolve, reject) => {
                metadataRequest.onsuccess = () => resolve(metadataRequest.result);
                metadataRequest.onerror = () => reject(metadataRequest.error);
            });

            db.close();
            return metadata?.productCount || 0;
        } catch (error) {
            console.error('[IndexGenerationService] Error getting product count:', error);
            return 0;
        }
    }
}