import { decode, DecodeError } from "@msgpack/msgpack";
import { encodeHashToBase64 } from "@holochain/client"; // Removed HolochainClient import
import { getActiveCloneCellId } from "../products/utils/cloneHelpers";

// Quantization utilities for embedding compression
const quantizeEmbedding = (f32: Float32Array) => new Int8Array(f32.map(v => Math.round(v * 127)));
const dequantizeEmbedding = (i8: Int8Array) => new Float32Array(i8.map(v => v / 127));

// SearchCacheService.ts

// Data structure from Holochain zome call (before processing)
interface RawProductDataFromZome {
    name: string;
    price: number;
    size: string;
    category: string;
    subcategory?: string;
    product_type?: string;
    image_url?: string;
    promo_price?: number;
    stocks_status?: string;
    sold_by?: string;
    product_id?: string;
    upc?: string;
    embedding?: number[];
    [key: string]: any; // For other potential fields
}

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

// Structure of a Holochain record containing a product group
interface ProductGroupRecord {
    signed_action: {
        hashed: {
            hash: Uint8Array; // ActionHash
        };
    };
    entry: {
        Present: {
            entry: Uint8Array; // MsgPack encoded ProductGroup entry
        };
    };
}

// Decoded ProductGroup entry from MsgPack
interface DecodedProductGroup {
    products: RawProductDataFromZome[];
    // other fields if any, e.g., category_path
}


const CACHE_KEY = 'product_search_index_cache'; // Not directly used, but good for reference
const CACHE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const LOOKUP_TABLES_KEY = 'lookup_tables_v1' as const; // Use 'as const' for literal type
const CACHE_VERSION = 1; // Increment when changing cache structure

// Top categories to load first for better user experience
const TOP_CATEGORIES = ["Produce", "Beverages", "Dairy & Eggs", "Snacks & Candy", "Meat & Seafood"];
// All remaining categories
const ALL_CATEGORIES = ["Wine", "Frozen", "Prepared Foods", "Liquor", "Floral", "Household", "Bakery",
    "Deli", "Canned Goods & Soups", "Beer", "Pets", "Breakfast", "Condiments & Sauces",
    "Personal Care", "Dry Goods & Pasta", "Oils, Vinegars, & Spices", "Health Care",
    "Baking Essentials", "Kitchen Supplies", "Hard Beverages", "Miscellaneous",
    "Party & Gift Supplies", "Office & Craft", "Baby"];

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

    // Get the cell_id for targeting the current active clone
    private static async getActiveCloneCellId(store: HolochainStore): Promise<any> {
        const cellId = await getActiveCloneCellId(store.service.client as any);
        return cellId;
    }

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

    static async getSearchIndex(store: HolochainStore, forceRefresh: boolean = false): Promise<ProcessedProduct[]> {
        if (forceRefresh) {
            await this.clearCache();
            return this.buildIndexFromCategories(store);
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
            console.log(`[SearchCacheService] Found ${keys.length} keys in cache:`, keys.slice(0, 5).map(k => String(k)));

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
                    console.log('[SearchCacheService] Cache validation failed, rebuilding index from DHT');
                    return this.buildIndexFromCategories(store);
                }
                return allProducts;
            } else {
                console.log('[SearchCacheService] Cache invalid or expired, rebuilding index from DHT');
            }
        } catch (error) {
            console.error('[SearchCacheService] Error accessing IndexedDB cache:', error);
        }
        return this.buildIndexFromCategories(store);
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

    private static async buildIndexFromCategories(store: HolochainStore): Promise<ProcessedProduct[]> {
        let allProducts: ProcessedProduct[] = [];

        this.initializeLookupTables();

        try {
            console.log('[SearchCacheService] Building search index from Holochain DHT using bulk fetch');

            // Single bulk call to get all products
            console.time('[SearchCacheService] Bulk fetch all products');
            
            // CRITICAL FIX: Handle case where no active clone exists yet
            let cellId;
            try {
                cellId = await this.getActiveCloneCellId(store);
            } catch (error) {
                console.warn('[SearchCacheService] No active clone available for search index building');
                return [];
            }
            const response: { products: ProductGroupRecord[], total: number } = await store.service.client.callZome({
                cell_id: cellId,
                zome_name: "product_catalog",
                fn_name: "get_all_products_for_search_index",
                payload: null,
            });
            console.timeEnd('[SearchCacheService] Bulk fetch all products');

            if (response && response.products && response.products.length > 0) {
                console.log(`[SearchCacheService] Received ${response.products.length} ProductGroups containing ${response.total} total products`);

                // Extract products from all groups
                console.time('[SearchCacheService] Extract and process products');
                const productsFromGroups = this.extractProductsFromGroups(response.products);
                allProducts.push(...productsFromGroups);
                console.timeEnd('[SearchCacheService] Extract and process products');

                console.log(`[SearchCacheService] Extracted ${allProducts.length} products from groups`);
            } else {
                console.warn('[SearchCacheService] No products returned from bulk fetch');
            }

            console.log(`[SearchCacheService] Lookup tables created:`, {
                categories: Object.keys(this.lookupTables.categories).length,
                subcategories: Object.keys(this.lookupTables.subcategories).length,
                productTypes: Object.keys(this.lookupTables.productTypes).length,
                brands: Object.keys(this.lookupTables.brands).length
            });

            console.log(`[SearchCacheService] Writing complete cache with ${allProducts.length} products...`);
            await this.updateCache(allProducts);

            console.log(`[SearchCacheService] Search index initialized with ${allProducts.length} products`);
            return allProducts;
        } catch (error) {
            console.error("[SearchCacheService] Error building search index:", error);
            return [];
        }
    }

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
    private static addToLookupTable(value: string | null | undefined, table: LookupTable, reverseTable: ReverseLookupTable): number {
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

    /**
     * Extract products from Holochain product groups and collect unique values for lookup tables
     */
    private static extractProductsFromGroups(productGroups: ProductGroupRecord[]): ProcessedProduct[] {
        const extractedProducts: ProcessedProduct[] = [];
        let productsWithEmbeddings = 0;
        let totalProductsInGroups = 0;

        for (const record of productGroups) {
            try {
                const groupHash = record.signed_action.hashed.hash; // This is Uint8Array
                const groupEntryData = record.entry.Present.entry;
                const decodedData = decode(groupEntryData); // This is 'unknown'

                // Runtime check for the structure of DecodedProductGroup
                // Ensure decodedData is an object, not null, has a 'products' property, and that property is an array.
                if (decodedData && typeof decodedData === 'object' && decodedData !== null &&
                    'products' in decodedData && Array.isArray((decodedData as { products: unknown[] }).products)) {
                    const groupEntry = decodedData as DecodedProductGroup; // Now the assertion is safer

                    totalProductsInGroups += groupEntry.products.length;

                    groupEntry.products.forEach((rawProduct: RawProductDataFromZome, index: number) => {
                        let embeddingTypedArray: Float32Array | undefined = undefined;
                        if (rawProduct.embedding && Array.isArray(rawProduct.embedding) && rawProduct.embedding.length > 0) {
                            try {
                                embeddingTypedArray = new Float32Array(rawProduct.embedding);
                                productsWithEmbeddings++;
                            } catch (err) {
                                console.error('Error converting to Float32Array:', err, rawProduct.embedding);
                                embeddingTypedArray = new Float32Array();
                            }
                        } else {
                            embeddingTypedArray = new Float32Array();
                        }

                        const categoryId = this.addToLookupTable(rawProduct.category, this.lookupTables.categories, this.lookupTables.reverseCategories);
                        const subcategoryId = this.addToLookupTable(rawProduct.subcategory, this.lookupTables.subcategories, this.lookupTables.reverseSubcategories);
                        const productTypeId = this.addToLookupTable(rawProduct.product_type, this.lookupTables.productTypes, this.lookupTables.reverseProductTypes);

                        let brandName: string | null = null;
                        if (rawProduct.name) {
                            const parts = rawProduct.name.split(' ');
                            if (parts.length > 0 && parts[0].length > 1 && parts[0] === parts[0].toUpperCase()) { // Simple brand heuristic
                                brandName = parts[0];
                            }
                        }
                        const brandId = this.addToLookupTable(brandName, this.lookupTables.brands, this.lookupTables.reverseBrands);

                        const productHashObject: ProductHashObject = {
                            groupHash: encodeHashToBase64(groupHash), // Convert to base64 immediately for consistency
                            index: index,
                            toString: function (this: ProductHashObject) {
                                return `${this.groupHash}:${this.index}`; // groupHash is now always a string
                            }
                        };

                        extractedProducts.push({
                            name: rawProduct.name,
                            price: rawProduct.price,
                            promo_price: rawProduct.promo_price,
                            size: rawProduct.size,
                            stocks_status: rawProduct.stocks_status,
                            categoryId,
                            subcategoryId,
                            productTypeId,
                            brandId,
                            category: rawProduct.category, // Keep original strings for immediate use
                            subcategory: rawProduct.subcategory || null,
                            product_type: rawProduct.product_type || null,
                            brand: brandName,
                            image_url: rawProduct.image_url,
                            sold_by: rawProduct.sold_by,
                            productId: rawProduct.product_id,
                            upc: rawProduct.upc,
                            embedding: embeddingTypedArray,
                            hash: productHashObject,
                            // Removed hashString, normalization will create string hash from ProductHashObject
                        });
                    });
                } else {
                    // Data does not conform to DecodedProductGroup structure
                    console.warn(
                        "[SearchCacheService] Decoded group entry did not conform to DecodedProductGroup structure or was null/undefined. Skipping group. GroupHash (first 10 chars of ActionHash):",
                        encodeHashToBase64(record.signed_action.hashed.hash).substring(0, 10),
                        "Actual decoded data:", decodedData
                    );
                    // This group will be skipped, and processing will continue with the next group.
                }
            } catch (error) {
                if (error instanceof DecodeError) {
                    // DecodeError from msgpack doesn't have a byteOffset property in its standard definition.
                    // Log the message and potentially the raw data if needed for debugging.
                    console.error("MsgPack DecodeError extracting products from group:", error.message /*, record.entry.Present.entry */);
                } else {
                    console.error("Error extracting products from group:", error);
                }
            }
        }
        console.log(`[SearchCacheService] Extracted ${extractedProducts.length} products from ${productGroups.length} groups. ${productsWithEmbeddings}/${totalProductsInGroups} have embeddings.`);
        return extractedProducts;
    }

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

    private static async updateCache(products: ProcessedProduct[]): Promise<void> {
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
