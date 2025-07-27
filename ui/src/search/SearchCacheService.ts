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

// Product structure optimized for IndexedDB storage (normalized, embeddings as ArrayBuffer)
interface StoredProductRecord {
    name: string;
    price: number;
    promo_price?: number;
    size: string;
    stocks_status?: string;

    // Normalized fields (IDs)
    categoryId: number;
    subcategoryId: number;
    productTypeId: number;
    brandId: number;

    // Other non-normalized string fields
    image_url?: string;
    sold_by?: string;
    productId?: string;
    upc?: string;

    embeddingBuffer?: ArrayBuffer; // Embeddings stored as ArrayBuffer

    // Hash can be a string (preferred for storage) or a legacy object during transition
    hash: string | ProductHashObject; // ProductHashObject for legacy cases
    // where needsToString might be true

    // Allow other dynamic fields if strictly necessary, though ideally defined
    [key: string]: any;
}

// Product structure for client-side use (denormalized, embeddings as Float32Array)
interface ProcessedProduct {
    name: string;
    price: number;
    promo_price?: number;
    size: string;
    stocks_status?: string;

    // Denormalized string fields
    category: string | null;
    subcategory: string | null;
    product_type: string | null;
    brand: string | null; // Assuming brandId maps to brand name

    // Original IDs for reference
    categoryId: number;
    subcategoryId: number;
    productTypeId: number;
    brandId: number;

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


// Lookup table interfaces for string normalization
interface LookupTable {
    [key: string]: number; // e.g. "Produce": 1
}

interface ReverseLookupTable {
    [key: number]: string; // e.g. 1: "Produce"
}

interface NormalizedLookupTables {
    categories: LookupTable;
    reverseCategories: ReverseLookupTable;
    subcategories: LookupTable;
    reverseSubcategories: ReverseLookupTable;
    productTypes: LookupTable;
    reverseProductTypes: ReverseLookupTable;
    brands: LookupTable;
    reverseBrands: ReverseLookupTable;
}

// For data stored in IndexedDB related to lookup tables
interface LookupDataRecord {
    id: string; // Should be LOOKUP_TABLES_KEY
    tables: NormalizedLookupTables;
    timestamp: number;
}

// For metadata stored in IndexedDB
interface CacheMetadata {
    id: string; // Should be 'metadata_v1'
    timestamp: number;
    productCount: number;
    lastUpdate: string;
    version: number;
    normalized: boolean; // Indicates if products in cache are normalized
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


// Removed unused CACHE_KEY constant
const CACHE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const LOOKUP_TABLES_KEY = 'lookup_tables_v1' as const; // Use 'as const' for literal type
const CACHE_VERSION = 1; // Increment when changing cache structure

// Removed legacy TOP_CATEGORIES and ALL_CATEGORIES - Agent 1 fetches ALL products in one batch!

export default class SearchCacheService {
    // Class variable for database connection
    private static dbPromise: Promise<IDBDatabase> | null = null;

    // Lookup tables for string normalization
    private static lookupTables: NormalizedLookupTables = {
        categories: {},
        reverseCategories: {},
        subcategories: {},
        reverseSubcategories: {},
        productTypes: {},
        reverseProductTypes: {},
        brands: {},
        reverseBrands: {}
    };

    // Legacy getActiveCloneCellId method removed - Agent 1 handles Holochain cell operations

    // Open database connection
    private static openDatabase(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request: IDBOpenDBRequest = indexedDB.open('product-search-cache', 4);

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
                console.log('Created new products object store with version 4 (optimized with lookup tables)');
            };
        });
    }

    static async getSearchIndex(_store: HolochainStore, forceRefresh: boolean = false): Promise<ProcessedProduct[]> {
        if (forceRefresh) {
            await this.clearCache();
            console.log('[SearchCacheService] Force refresh requested - cache cleared, returning empty array');
            return [];
        }

        try {
            if (!this.dbPromise) {
                this.dbPromise = this.openDatabase();
            }
            const db = await this.dbPromise;

            const tx = db.transaction('products', 'readonly');
            const productsStore = tx.objectStore('products');

            const keysRequest = productsStore.getAllKeys();
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
                keysRequest.onsuccess = () => resolve(keysRequest.result);
                keysRequest.onerror = () => reject(keysRequest.error);
            });
            console.log(`[SearchCacheService] Found ${keys.length} keys in cache:`, keys.map(k => String(k)));
            
            // DEBUG: Get sizes of all records
            for (const key of keys) {
                try {
                    const getRequest = productsStore.get(key);
                    await new Promise<any>((resolve, reject) => {
                        getRequest.onsuccess = () => resolve(getRequest.result);
                        getRequest.onerror = () => reject(getRequest.error);
                    });
                    
                    // Record processed but no debug logging needed
                } catch (error) {
                    // Error reading record - no debug logging needed
                }
            }

            const hasLookupTables = keys.includes(LOOKUP_TABLES_KEY);

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
                console.log(`[SearchCacheService] Valid cache found with ${metadataItem.productCount} products, age: ${Math.floor(cacheAge / (60 * 60 * 1000))} hours`);

                if (hasLookupTables) {
                    const lookupRequest = productsStore.get(LOOKUP_TABLES_KEY);
                    const lookupData = await new Promise<LookupDataRecord | undefined>((resolve, reject) => {
                        lookupRequest.onsuccess = () => resolve(lookupRequest.result as LookupDataRecord | undefined);
                        lookupRequest.onerror = () => reject(lookupRequest.error);
                    });

                    if (lookupData) {
                        this.lookupTables = lookupData.tables;
                        console.log(`[SearchCacheService] Loaded lookup tables with ${Object.keys(this.lookupTables.categories).length} categories, ${Object.keys(this.lookupTables.subcategories).length} subcategories, ${Object.keys(this.lookupTables.productTypes).length} product types`);
                    } else {
                        console.warn('[SearchCacheService] Lookup tables key exists but data not found');
                    }
                }

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
                                let productToProcess: StoredProductRecord | ProcessedProduct = storedProduct;

                                if (hasLookupTables && metadataItem.normalized) {
                                    // Type assertion needed as denormalizeProduct expects StoredProductRecord
                                    productToProcess = this.denormalizeProduct(storedProduct as StoredProductRecord);
                                }

                                // Ensure productToProcess is treated as a mutable object for further modifications
                                const fullyProcessedProduct: ProcessedProduct = { ...productToProcess } as ProcessedProduct;


                                if (storedProduct.embeddingBuffer) {
                                    try {
                                        // Dequantize embedding from storage
                                        const quantized = new Int8Array(storedProduct.embeddingBuffer);
                                        fullyProcessedProduct.embedding = dequantizeEmbedding(quantized);
                                        arrayBufferCount++;
                                        delete (fullyProcessedProduct as any).embeddingBuffer; // Remove after conversion
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
                                // storedProduct.hash could be string or ProductHashObject (legacy)
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
                                    // It's already a valid ProductHashObject
                                    fullyProcessedProduct.hash = currentHash as ProductHashObject;
                                } else {
                                    // Fallback or error if hash is in an unexpected format
                                    console.warn("Product hash in unexpected format:", currentHash);
                                    // Provide a default hash object to satisfy ProcessedProduct type
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

                console.log(`[SearchCacheService] Loaded ${allProducts.length} products from cache. Found ${arrayBufferCount} products with ArrayBuffer embeddings and ${productsWithEmbeddingsFromArray} with array embeddings.`);

                const hasValidData = this.validateCachedProducts(allProducts);
                if (!hasValidData) {
                    console.log('[SearchCacheService] Cache validation failed - returning empty array');
                    return [];
                }
                return allProducts;
            } else {
                console.log('[SearchCacheService] Cache invalid or expired - returning empty array');
                return [];
            }
        } catch (error) {
            console.error('[SearchCacheService] Error accessing IndexedDB cache:', error);
            console.log('[SearchCacheService] Cache error - returning empty array');
            return [];
        }
    }

    private static validateCachedProducts(products: ProcessedProduct[]): boolean {
        if (!products.length) {
            console.log('[SearchCacheService] No products found in cache');
            return false;
        }
        const sampleSize = Math.min(10, products.length);
        const sampleProducts = products.slice(0, sampleSize);

        for (const product of sampleProducts) {
            if (!product.name || product.category === undefined) { // category can be null, so check for undefined
                console.log('[SearchCacheService] Product missing essential properties (name or category info)');
                return false;
            }
        }

        const withEmbeddings = products.filter(p => p.embedding && p.embedding.length > 0).length;
        const withTypedEmbeddings = products.filter(p => p.embedding instanceof Float32Array).length;
        console.log(`[SearchCacheService] Product cache stats: ${withEmbeddings}/${products.length} have embeddings, ${withTypedEmbeddings} are Float32Arrays`);
        return true;
    }

    // Legacy buildIndexFromCategories method removed - Agent 1 handles index building via IndexGenerationService

    /**
     * Initialize empty lookup tables
     */
    private static initializeLookupTables(): void {
        this.lookupTables = {
            categories: {}, reverseCategories: {},
            subcategories: {}, reverseSubcategories: {},
            productTypes: {}, reverseProductTypes: {},
            brands: {}, reverseBrands: {}
        };
    }

    /**
     * Add a value to the appropriate lookup table if it doesn't exist
     */
    private static _addToLookupTable(value: string | null | undefined, table: LookupTable, reverseTable: ReverseLookupTable): number {
        if (value === null || value === undefined || value.trim() === '') {
            return 0; // 0 for null, undefined, or empty strings
        }
        if (table[value] !== undefined) {
            return table[value];
        }
        const newId = Object.keys(table).length + 1;
        table[value] = newId;
        reverseTable[newId] = value;
        return newId;
    }

    /**
     * Get a value from the reverse lookup table
     */
    private static getFromReverseLookup(id: number, reverseTable: ReverseLookupTable): string | null {
        if (id === 0) return null;
        return reverseTable[id] || null;
    }

    // Legacy extractProductsFromGroups method removed - Agent 1 handles product extraction via IndexGenerationService

    /**
     * Normalize a product for storage by replacing strings with IDs and converting hash to string.
     */
    private static normalizeProduct(product: ProcessedProduct): StoredProductRecord {
        // Create a new object that conforms to StoredProductRecord
        const normalized: Partial<StoredProductRecord> & { [key: string]: any } = { ...product };

        // Delete fields that are part of ProcessedProduct but not StoredProductRecord (denormalized strings)
        delete normalized.category;
        delete normalized.subcategory;
        delete normalized.product_type;
        delete normalized.brand;

        // Convert hash object to string for storage
        if (normalized.hash && typeof normalized.hash === 'object' && typeof normalized.hash.toString === 'function') {
            normalized.hash = (normalized.hash as ProductHashObject).toString();
        } else if (typeof normalized.hash !== 'string') {
            // Fallback if hash is not in expected format
            console.warn("Normalizing product with unexpected hash format:", normalized.hash);
            normalized.hash = ':0'; // Default string hash
        }
        // embedding is handled in updateCache, converting Float32Array to ArrayBuffer

        return normalized as StoredProductRecord;
    }

    /**
     * Denormalize a product by replacing IDs with string values. Hash remains an object.
     */
    private static denormalizeProduct(product: StoredProductRecord): ProcessedProduct {
        // Type assertion: treat product as a base for ProcessedProduct
        const denormalized = { ...product } as unknown as ProcessedProduct;

        denormalized.category = this.getFromReverseLookup(product.categoryId, this.lookupTables.reverseCategories);
        denormalized.subcategory = this.getFromReverseLookup(product.subcategoryId, this.lookupTables.reverseSubcategories);
        denormalized.product_type = this.getFromReverseLookup(product.productTypeId, this.lookupTables.reverseProductTypes);
        denormalized.brand = this.getFromReverseLookup(product.brandId, this.lookupTables.reverseBrands);

        // Hash is handled in getSearchIndex when loading from cache, converting string back to object if needed.
        // Here, we assume if product.hash is already an object, it's a ProductHashObject.
        // If it's a string, getSearchIndex will convert it.
        // For type safety, ensure denormalized.hash is ProductHashObject.
        // This part is mostly handled by getSearchIndex's product mapping logic.
        // If product.hash is a string here, it will be converted later.
        // If it's an object, it should already be ProductHashObject-like.
        if (typeof product.hash === 'string') {
            // This will be converted to ProductHashObject in getSearchIndex
            // For now, to satisfy ProcessedProduct, we might need a temporary cast or structure
            // However, the main conversion logic is in getSearchIndex
        } else { // It's a ProductHashObject (potentially legacy)
            denormalized.hash = product.hash as ProductHashObject;
        }


        return denormalized;
    }

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

            const lookupTablesRecord: LookupDataRecord = {
                id: LOOKUP_TABLES_KEY,
                tables: this.lookupTables,
                timestamp: Date.now()
            };
            const lookupPutRequest = objectStore.put(lookupTablesRecord);
            await new Promise<void>((resolve, reject) => {
                lookupPutRequest.onsuccess = () => resolve();
                lookupPutRequest.onerror = (e) => reject((e.target as IDBRequest).error);
            });
            console.log(`[SearchCacheService] Stored lookup tables...`);

            const metadata: CacheMetadata = {
                id: 'metadata_v1',
                timestamp: Date.now(),
                productCount: products.length,
                lastUpdate: new Date().toISOString(),
                version: CACHE_VERSION,
                normalized: true
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
                    const normalizedProduct = this.normalizeProduct(product); // Returns StoredProductRecord shell
                    const storableProduct: StoredProductRecord = { ...normalizedProduct }; // Ensure all StoredProductRecord fields

                    if (product.embedding instanceof Float32Array && product.embedding.length > 0) {
                        try {
                            // Quantize embedding for storage (75% size reduction)
                            const quantized = quantizeEmbedding(product.embedding);
                            storableProduct.embeddingBuffer = quantized.buffer;

                            productsWithTypedEmbeddings++;
                            totalBufferSize += storableProduct.embeddingBuffer.byteLength;
                            delete (storableProduct as any).embedding; // Remove original Float32Array property
                        } catch (err) {
                            console.error('Error creating ArrayBuffer from Float32Array:', err);
                            // storableProduct.embeddingBuffer remains undefined
                        }
                    }
                    // 'embedding' field is not part of StoredProductRecord
                    // Ensure no 'embedding: Float32Array' field is on storableProduct
                    if ('embedding' in storableProduct && !(storableProduct as any).embeddingBuffer) {
                        delete (storableProduct as any).embedding;
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

            console.log(`[SearchCacheService] Cached ${products.length} products. ` +
                `${productsWithTypedEmbeddings} have quantized embeddings. ` +
                `Total buffer size: ${(totalBufferSize / (1024 * 1024)).toFixed(2)}MB`);
        } catch (error) {
            console.error('[SearchCacheService] Error updating IndexedDB cache:', error);
        }
    }

    static async clearCache(): Promise<void> {
        try {
            let dbDatabases: IDBDatabaseInfo[] | undefined; // Correct type is IDBDatabaseInfo
            if (typeof indexedDB.databases === 'function') {
                dbDatabases = await indexedDB.databases();
            }

            if (!dbDatabases || !dbDatabases.some(db => db.name === 'product-search-cache')) {
                console.log('[SearchCacheService] No IndexedDB named "product-search-cache" to clear.');
                this.initializeLookupTables(); // Still reset in-memory tables
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
            this.initializeLookupTables();
        } catch (error) {
            console.error('[SearchCacheService] Error clearing IndexedDB cache:', error);
        }
    }
}
