// Legacy imports removed - Agent 1 handles product fetching and processing
import { encodeHashToBase64 } from "@holochain/client";

// Quantization utilities for embedding compression
const quantizeEmbedding = (f32: Float32Array) => new Int8Array(f32.map(v => Math.round(v * 127)));
const dequantizeEmbedding = (i8: Int8Array) => new Float32Array(i8.map(v => v / 127));

// SearchCacheService.ts

// Legacy RawProductDataFromZome interface removed - Agent 1 handles raw product processing

// Represents the hash object associated with a product
interface ProductHashObject {
    groupHash: Uint8Array | string; // Uint8Array from zome, string if already base64 encoded
    index: number;
    toString(): string;
    needsToString?: boolean; // For legacy cache objects that need toString restored
}

// Product structure optimized for IndexedDB storage with PURE STRINGS (NO LOOKUP TABLES)
interface StoredProductRecord {
    name: string;
    price: number;
    promo_price?: number;
    size: string;
    stocks_status?: string;

    // PURE STRING FIELDS - NO NORMALIZATION
    category: string | null;
    subcategory: string | null;
    product_type: string | null;
    brand: string | null;

    // Other fields
    image_url?: string;
    sold_by?: string;
    productId?: string;
    upc?: string;

    embeddingBuffer?: ArrayBuffer; // Embeddings stored as ArrayBuffer

    // Hash as string for storage
    hash: string | ProductHashObject;

    // Allow other dynamic fields if needed
    [key: string]: any;
}

// Product structure for client-side use with PURE STRINGS (embeddings as Float32Array)
interface ProcessedProduct {
    name: string;
    price: number;
    promo_price?: number;
    size: string;
    stocks_status?: string;

    // PURE STRING FIELDS - NO IDs
    category: string | null;
    subcategory: string | null;
    product_type: string | null;
    brand: string | null;

    // Other string fields
    image_url?: string;
    sold_by?: string;
    productId?: string;
    upc?: string;

    embedding?: Float32Array; // Processed embedding
    hash: ProductHashObject; // Hash as an object with a toString method

    // Allow other dynamic fields
    [key: string]: any;
}



// For metadata stored in IndexedDB
interface CacheMetadata {
    id: string; // Should be 'metadata_v1'
    timestamp: number;
    productCount: number;
    lastUpdate: string;
    version: number;
    // normalized field removed - pure strings only
}

// For product chunks stored in IndexedDB
interface ProductChunk {
    id: string; // e.g., 'chunk_0'
    products: StoredProductRecord[];
}

// Minimal type for the Holochain store/client passed to methods
// Using 'any' for the client type to avoid import issues if HolochainClient is not a direct export
// or if the actual client object has a different specific type.
// The critical part is that it must have a callZome method.
interface HolochainStore {
    service: {
        client: {
            callZome: (args: {
                cell_id?: any;
                role_name?: string;
                zome_name: string;
                fn_name: string;
                payload: any;
            }) => Promise<any>;
            appInfo: () => Promise<any>;
            myPubKey: any;
        };
    };
}

// Legacy ProductGroupRecord and DecodedProductGroup interfaces removed - Agent 1 handles Holochain data structures


// Cache configuration
const CACHE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const CACHE_VERSION = 2; // Increment when changing cache structure - v2 = pure strings


export default class SearchCacheService {
    // Class variable for database connection
    private static dbPromise: Promise<IDBDatabase> | null = null;

    
    // Legacy getActiveCloneCellId method removed - Agent 1 handles Holochain cell operations

    // Open database connection
    private static openDatabase(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request: IDBOpenDBRequest = indexedDB.open('product-search-cache', 5);

            request.onerror = (event: Event) => {
                console.error('IndexedDB error:', (event.target as IDBRequest).error);
                reject('Error opening database');
            };

            request.onsuccess = (event: Event) => {
                resolve((event.target as IDBOpenDBRequest).result);
            };

            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                const db = (event.target as IDBOpenDBRequest).result;

                if (db.objectStoreNames.contains('products')) {
                    db.deleteObjectStore('products');
                }
                db.createObjectStore('products', { keyPath: 'id' });
                console.log('Created new products object store with version 5 (pure strings, no lookup tables)');
            };
        });
    }

    static async getSearchIndex(_store: HolochainStore, forceRefresh: boolean = false): Promise<ProcessedProduct[]> {
        if (forceRefresh) {
            await this.clearCache();
            return [];
        }

        try {
            if (!this.dbPromise) {
                this.dbPromise = this.openDatabase();
            }
            const db = await this.dbPromise;

            const tx = db.transaction('products', 'readonly');
            const productsStore = tx.objectStore('products');

            const metadataRequest = productsStore.get('metadata_v1');
            const metadataItem = await new Promise<CacheMetadata | undefined>((resolve, reject) => {
                metadataRequest.onsuccess = () => resolve(metadataRequest.result as CacheMetadata | undefined);
                metadataRequest.onerror = () => reject(metadataRequest.error);
            });

            const cacheAge = metadataItem?.timestamp ? Date.now() - metadataItem.timestamp : Infinity;
            const isValid = metadataItem &&
                metadataItem.productCount > 0 &&
                cacheAge < CACHE_TIMEOUT &&
                metadataItem.version === CACHE_VERSION;

            if (isValid) {
                const allProducts: ProcessedProduct[] = [];
                let chunkIndex = 0;
                let hasMoreChunks = true;
                let arrayBufferCount = 0;
                let productsWithEmbeddingsFromArray = 0;

                while (hasMoreChunks) {
                    const chunkId = `chunk_${chunkIndex}`;
                    try {
                        const chunkRequest = productsStore.get(chunkId);
                        const chunk = await new Promise<ProductChunk | undefined>((resolve, reject) => {
                            chunkRequest.onsuccess = () => resolve(chunkRequest.result as ProductChunk | undefined);
                            chunkRequest.onerror = () => reject(chunkRequest.error);
                        });

                        if (chunk && chunk.products && chunk.products.length > 0) {
                            const processedChunkProducts: ProcessedProduct[] = chunk.products.map((storedProduct: StoredProductRecord) => {
                                // Simple conversion - NO LOOKUP TABLE LOGIC
                                const fullyProcessedProduct: ProcessedProduct = {
                                    ...storedProduct,
                                    // String fields are already pure strings
                                    category: storedProduct.category,
                                    subcategory: storedProduct.subcategory, 
                                    product_type: storedProduct.product_type,
                                    brand: storedProduct.brand
                                } as ProcessedProduct;

                                // Convert embedding ArrayBuffer to Float32Array
                                if (storedProduct.embeddingBuffer) {
                                    try {
                                        const quantized = new Int8Array(storedProduct.embeddingBuffer);
                                        fullyProcessedProduct.embedding = dequantizeEmbedding(quantized);
                                        arrayBufferCount++;
                                        delete (fullyProcessedProduct as any).embeddingBuffer;
                                    } catch (err) {
                                        console.error('Error converting ArrayBuffer to Float32Array:', err);
                                        fullyProcessedProduct.embedding = new Float32Array();
                                    }
                                } else if (fullyProcessedProduct.embedding && Array.isArray(fullyProcessedProduct.embedding)) {
                                    try {
                                        fullyProcessedProduct.embedding = new Float32Array(fullyProcessedProduct.embedding);
                                        productsWithEmbeddingsFromArray++;
                                    } catch (err) {
                                        console.error('Error converting array to Float32Array:', err);
                                        fullyProcessedProduct.embedding = new Float32Array();
                                    }
                                } else {
                                    fullyProcessedProduct.embedding = new Float32Array();
                                }

                                // Recreate hash toString method
                                const currentHash = storedProduct.hash;
                                if (typeof currentHash === 'string' && currentHash.includes(':')) {
                                    const [groupHashStr, indexStr] = currentHash.split(':');
                                    fullyProcessedProduct.hash = {
                                        groupHash: groupHashStr,
                                        index: parseInt(indexStr, 10),
                                        toString: function (this: ProductHashObject) {
                                            return `${this.groupHash}:${this.index}`;
                                        }
                                    };
                                } else if (typeof currentHash === 'object' && (currentHash as ProductHashObject).needsToString) {
                                    const hashObj = currentHash as ProductHashObject;
                                    hashObj.toString = function (this: ProductHashObject) {
                                        const groupHashStr = (this.groupHash instanceof Uint8Array)
                                            ? encodeHashToBase64(this.groupHash)
                                            : String(this.groupHash);
                                        return `${groupHashStr}:${this.index}`;
                                    };
                                    delete hashObj.needsToString;
                                    fullyProcessedProduct.hash = hashObj;
                                } else if (typeof currentHash === 'object' && typeof (currentHash as ProductHashObject).toString === 'function') {
                                    fullyProcessedProduct.hash = currentHash as ProductHashObject;
                                } else {
                                    console.warn("Product hash in unexpected format:", currentHash);
                                    fullyProcessedProduct.hash = {
                                        groupHash: '', index: 0, toString: () => ':0'
                                    };
                                }
                                return fullyProcessedProduct;
                            });

                            allProducts.push(...processedChunkProducts);
                            chunkIndex++;
                        } else {
                            hasMoreChunks = false;
                        }
                    } catch (error) {
                        console.error(`[SearchCacheService] Error loading chunk ${chunkId}:`, error);
                        hasMoreChunks = false;
                    }
                }

                const hasValidData = this.validateCachedProducts(allProducts);
                if (!hasValidData) {
                    return [];
                }
                return allProducts;
            } else {
                return [];
            }
        } catch (error) {
            console.error('[SearchCacheService] Error accessing IndexedDB cache:', error);
            return [];
        }
    }

    private static validateCachedProducts(products: ProcessedProduct[]): boolean {
        if (!products.length) {
            return false;
        }
        const sampleSize = Math.min(10, products.length);
        const sampleProducts = products.slice(0, sampleSize);

        for (const product of sampleProducts) {
            if (!product.name || product.category === undefined) { // category can be null, so check for undefined
                return false;
            }
        }

        const withEmbeddings = products.filter(p => p.embedding && p.embedding.length > 0).length;
        const withTypedEmbeddings = products.filter(p => p.embedding instanceof Float32Array).length;
        console.log(`[SearchCacheService] Product cache stats: ${withEmbeddings}/${products.length} have embeddings, ${withTypedEmbeddings} are Float32Arrays`);
        return true;
    }

    // Legacy buildIndexFromCategories method removed - Agent 1 handles index building via IndexGenerationService


    // Legacy extractProductsFromGroups method removed - Agent 1 handles product extraction via IndexGenerationService


    static async updateCache(products: ProcessedProduct[]): Promise<void> {
        try {
            let productsWithTypedEmbeddings = 0;
            let totalBufferSize = 0;

            if (!this.dbPromise) {
                this.dbPromise = this.openDatabase();
            }
            const db = await this.dbPromise;

            const tx = db.transaction('products', 'readwrite');
            const objectStore = tx.objectStore('products');

            // Store metadata (no lookup tables needed)
            const metadata: CacheMetadata = {
                id: 'metadata_v1',
                timestamp: Date.now(),
                productCount: products.length,
                lastUpdate: new Date().toISOString(),
                version: CACHE_VERSION
            };
            const metadataPutRequest = objectStore.put(metadata);
            await new Promise<void>((resolve, reject) => {
                metadataPutRequest.onsuccess = () => resolve();
                metadataPutRequest.onerror = (e) => reject((e.target as IDBRequest).error);
            });
            console.log(`[SearchCacheService] Stored metadata for ${products.length} products`);

            const CHUNK_SIZE = 250;
            for (let i = 0; i < products.length; i += CHUNK_SIZE) {
                const chunkId = `chunk_${Math.floor(i / CHUNK_SIZE)}`;
                const productChunk = products.slice(i, i + CHUNK_SIZE);

                const serializableChunk: StoredProductRecord[] = productChunk.map(product => {
                    // Simple conversion - NO NORMALIZATION but preserve all existing fields
                    const storableProduct: StoredProductRecord = {
                        name: product.name,
                        price: product.price,
                        promo_price: product.promo_price,
                        size: product.size,
                        stocks_status: product.stocks_status,
                        
                        // Pure string fields - NO LOOKUP TABLES
                        category: product.category,
                        subcategory: product.subcategory,
                        product_type: product.product_type,
                        brand: product.brand,
                        
                        // Other fields
                        image_url: product.image_url,
                        sold_by: product.sold_by,
                        productId: product.productId,
                        upc: product.upc,
                        
                        // Convert hash object to string for storage
                        hash: (product.hash && typeof product.hash === 'object' && typeof product.hash.toString === 'function') 
                            ? product.hash.toString() 
                            : String(product.hash),
                            
                        // CRITICAL FIX: Preserve existing embeddingBuffer from IPFS import
                        embeddingBuffer: (product as any).embeddingBuffer
                    };

                    if (product.embedding instanceof Float32Array && product.embedding.length > 0) {
                        try {
                            // Quantize embedding for storage (75% size reduction)
                            const quantized = quantizeEmbedding(product.embedding);
                            storableProduct.embeddingBuffer = quantized.buffer;
                            productsWithTypedEmbeddings++;
                            totalBufferSize += storableProduct.embeddingBuffer.byteLength;
                        } catch (err) {
                            console.error('Error creating ArrayBuffer from Float32Array:', err);
                        }
                    }

                    return storableProduct;
                });

                try {
                    const putRequest = objectStore.put({ id: chunkId, products: serializableChunk } as ProductChunk);
                    await new Promise<void>((resolve, reject) => {
                        putRequest.onsuccess = () => resolve();
                        putRequest.onerror = (e) => reject((e.target as IDBRequest).error);
                    });
                    console.log(`[SearchCacheService] Stored chunk ${chunkId} with ${serializableChunk.length} products`);
                } catch (chunkError) {
                    console.error(`[SearchCacheService] Error storing chunk ${chunkId}:`, chunkError);
                    try {
                        const slimChunk = serializableChunk.map(p => {
                            const { embeddingBuffer, ...slimProduct } = p;
                            return slimProduct as StoredProductRecord;
                        });
                        const fallbackPutRequest = objectStore.put({ id: chunkId, products: slimChunk });
                        await new Promise<void>((resolve, reject) => {
                            fallbackPutRequest.onsuccess = () => resolve();
                            fallbackPutRequest.onerror = (e) => reject((e.target as IDBRequest).error);
                        });
                        console.log(`[SearchCacheService] Stored slim chunk ${chunkId} without embeddings`);
                    } catch (slimChunkError) {
                        console.error(`[SearchCacheService] Error storing slim chunk ${chunkId}:`, slimChunkError);
                    }
                }
            }

            await new Promise<void>((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject((e.target as IDBTransaction).error);
            });

            console.log(`[SearchCacheService] Cached ${products.length} products with pure strings. ` +
                `${productsWithTypedEmbeddings} have quantized embeddings. ` +
                `Total buffer size: ${(totalBufferSize / (1024 * 1024)).toFixed(2)}MB`);
        } catch (error) {
            console.error('[SearchCacheService] Error updating IndexedDB cache:', error);
        }
    }

    static async clearCache(): Promise<void> {
        try {
            let dbDatabases: IDBDatabaseInfo[] | undefined;
            if (typeof indexedDB.databases === 'function') {
                dbDatabases = await indexedDB.databases();
            }

            if (!dbDatabases || !dbDatabases.some(db => db.name === 'product-search-cache')) {
                console.log('[SearchCacheService] No IndexedDB named "product-search-cache" to clear.');
                return;
            }

            if (!this.dbPromise) {
                this.dbPromise = this.openDatabase();
            }
            const db = await this.dbPromise;

            const tx = db.transaction('products', 'readwrite');
            const store = tx.objectStore('products');
            const clearRequest = store.clear();

            await new Promise<void>((resolve, reject) => {
                clearRequest.onsuccess = () => resolve();
                clearRequest.onerror = (e) => reject((e.target as IDBRequest).error);
            });
            await new Promise<void>((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject((e.target as IDBTransaction).error);
            });

            console.log('[SearchCacheService] IndexedDB cache ("products" store) cleared');
        } catch (error) {
            console.error('[SearchCacheService] Error clearing IndexedDB cache:', error);
        }
    }
}
