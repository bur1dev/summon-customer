import { decode } from "@msgpack/msgpack";
import { encodeHashToBase64, decodeHashFromBase64, type HoloHash } from "@holochain/client";
import type { DecodedProductGroupEntry } from "../../search/search-utils";
import type { ProductRowCacheService } from "./ProductRowCacheService";
import { SimpleCloneCache } from "../utils/SimpleCloneCache";

// Exported service instance for direct imports
export let productDataService: ProductDataService | null = null;

export function setProductDataService(service: ProductDataService): void {
    productDataService = service;
}


interface RawProductFromDHT {
    name: string;
    price?: number;
    promo_price?: number;
    size?: string;
    category?: string;
    subcategory?: string;
    product_type?: string;
    image_url?: string;
    sold_by?: string;
    product_id?: string;
    stocks_status?: string;
    embedding?: number[];
    brand?: string;
    is_organic?: boolean;
    [key: string]: any;
}

interface ProductWithClientHash extends RawProductFromDHT {
    hash: string; // groupHashBase64_index
}

interface HolochainRecord {
    entry: {
        Present: {
            entry: Uint8Array; // msgpack encoded
        };
    };
    signed_action: {
        hashed: {
            hash: HoloHash;
        };
    };
}

export interface NavigationParams {
    category: string;
    identifier: string;
    isProductType: boolean;
    selectedSubcategory?: string;
    currentRanges: Record<string, { start: number; end: number }>;
    totalProducts: Record<string, number>;
    containerCapacity: number;
}

export interface NavigationResult {
    newStart: number;
    products: ProductWithClientHash[];
    total: number;
    identifier: string;
    hasMore: boolean;
}

export class ProductDataService {
    private store: any;
    private cache: ProductRowCacheService;
    private cloneCache: SimpleCloneCache;
    private readonly PRODUCTS_PER_GROUP = 1000;
    private groupBoundaries: Map<string, Array<{ start: number; end: number }>> = new Map();

    constructor(store: any, cache: ProductRowCacheService, cloneCache?: SimpleCloneCache) {
        this.store = store;
        this.cache = cache;
        this.cloneCache = cloneCache || new SimpleCloneCache(store.client);
        console.log('🚀 ProductDataService initialized');
    }
    
    // Public getter for store access
    public get storeInstance(): any {
        return this.store;
    }

    // Get the cell_id for targeting the current active clone with caching
    private async getActiveCloneCellId(): Promise<any> {
        return await this.cloneCache.getActiveCellId();
    }

    // NEW: Method to get a single product by group hash and index for cart
    async getProductByReference(groupHashB64: string, productIndex: number): Promise<RawProductFromDHT | null> {
        try {
            // Just decode directly - no transformations needed
            const groupHash = decodeHashFromBase64(groupHashB64);

            // Get active clone cell_id for targeting
            const cellId = await this.getActiveCloneCellId();

            // Call the same zome method that the browsing system uses
            const result = await this.store.client.callZome({
                cell_id: cellId,
                zome_name: "product_catalog",
                fn_name: "get_product_group",
                payload: groupHash
            });

            if (result && result.entry && result.entry.Present && result.entry.Present.entry) {
                const group = decode(result.entry.Present.entry) as DecodedProductGroupEntry | null;

                if (group && group.products && productIndex < group.products.length) {
                    return group.products[productIndex];
                }
            }

            return null;
        } catch (error) {
            console.error('Error fetching product by reference:', error);
            return null;
        }
    }

    // NEW: Simple method to calculate total products for a path
    async calculateTotalForPath(
        category: string,
        subcategory?: string,
        productType?: string
    ): Promise<number> {
        try {
            const cellId = await this.getActiveCloneCellId();
            const response = await this.store.client.callZome({
                cell_id: cellId,
                zome_name: "product_catalog",
                fn_name: "get_all_group_counts_for_path",
                payload: {
                    category,
                    subcategory,
                    product_type: productType
                }
            });

            // Sum all group counts to get total
            let totalCount = 0;
            for (const count of response) {
                totalCount += Number(count) || 0;
            }

            return totalCount;
        } catch (error) {
            console.error('Error calculating total for path:', error);
            return 0;
        }
    }

    // Centralized product extraction - eliminates duplication
    extractProductsFromGroups(groupRecords: HolochainRecord[]): ProductWithClientHash[] {
        if (!groupRecords || groupRecords.length === 0) return [];
        let allProducts: ProductWithClientHash[] = [];

        for (const record of groupRecords) {
            try {
                const group = decode(record.entry.Present.entry) as DecodedProductGroupEntry | null;
                const groupHash = record.signed_action.hashed.hash;
                const groupHashBase64 = encodeHashToBase64(groupHash);

                if (group && group.products && Array.isArray(group.products)) {
                    const productsWithHash: ProductWithClientHash[] = group.products.map(
                        (product: RawProductFromDHT, index: number) => ({
                            ...product,
                            hash: `${groupHashBase64}_${index}`
                        })
                    );
                    allProducts = [...allProducts, ...productsWithHash];
                }
            } catch (error) {
                console.error('Error decoding product group:', error);
            }
        }
        return allProducts;
    }

    // Unified navigation method
    async navigate(
        direction: "left" | "right",
        params: NavigationParams
    ): Promise<NavigationResult> {
        const { identifier, currentRanges, totalProducts, containerCapacity } = params;

        // Initialize current range if not exists
        if (!currentRanges[identifier]) {
            currentRanges[identifier] = { start: 0, end: 0 };
        }

        const currentStart = currentRanges[identifier].start || 0;
        const currentEnd = currentRanges[identifier].end || 0;

        // Calculate target range
        let targetVirtualStart: number;
        if (direction === "left") {
            targetVirtualStart = Math.max(0, currentStart - containerCapacity);
        } else {
            targetVirtualStart = currentEnd;
        }

        const targetVirtualEnd = targetVirtualStart + containerCapacity;

        // Check cache first
        const cachedData = this.cache.getProductsInRange({
            category: params.category,
            identifier: params.isProductType ? identifier : params.identifier,
            isProductType: params.isProductType,
            startIndex: targetVirtualStart,
            capacity: containerCapacity
        });

        if (cachedData) {
            const cachedTotal = cachedData.totalInPath || totalProducts[identifier] || 0;
            return {
                newStart: targetVirtualStart,
                products: cachedData.products,
                total: cachedTotal,
                identifier,
                hasMore: targetVirtualEnd < cachedTotal
            };
        }

        // Initialize boundaries if needed
        await this.initializeGroupBoundaries(params);

        // Get group boundaries for this identifier
        const boundaries = this.groupBoundaries.get(identifier) || [];

        // Calculate group indices
        let startGroupIndex = 0;
        let endGroupIndex = 0;

        if (boundaries.length > 0) {
            for (let i = 0; i < boundaries.length; i++) {
                if (boundaries[i].start <= targetVirtualStart && targetVirtualStart < boundaries[i].end) {
                    startGroupIndex = i;
                }
                if (boundaries[i].start < targetVirtualEnd && targetVirtualEnd <= boundaries[i].end) {
                    endGroupIndex = i;
                    break;
                }
                if (i === boundaries.length - 1 && targetVirtualEnd > boundaries[i].end) {
                    endGroupIndex = i;
                }
            }

            if (endGroupIndex < startGroupIndex) {
                endGroupIndex = startGroupIndex;
            }
        }

        // Fetch groups
        const groupLimit = endGroupIndex - startGroupIndex + 1;
        const { products: accumulatedProducts, totalInPath, hasMore: newHasMore } =
            await this.fetchGroup(params, startGroupIndex, groupLimit);

        // Calculate slice indices
        let sliceStartIndex = 0;
        if (boundaries.length > 0 && boundaries[startGroupIndex]) {
            sliceStartIndex = Math.max(0, targetVirtualStart - boundaries[startGroupIndex].start);
        }

        const productsToShow = accumulatedProducts.slice(
            sliceStartIndex,
            sliceStartIndex + containerCapacity
        );

        // Calculate hasMore
        let hasMoreProducts = false;
        if (boundaries.length > 0 && boundaries[boundaries.length - 1]) {
            hasMoreProducts = targetVirtualEnd < boundaries[boundaries.length - 1].end;
        } else {
            hasMoreProducts = accumulatedProducts.length > containerCapacity;
        }

        // Cache the full group data
        const correctTotal = boundaries.length > 0 ? boundaries[boundaries.length - 1].end : 0;

        this.cache.setCacheGroup(
            params.category,
            params.isProductType ? identifier : params.identifier,
            params.isProductType,
            startGroupIndex,
            {
                products: accumulatedProducts,
                rangeStart: boundaries.length > 0 && boundaries[startGroupIndex]
                    ? boundaries[startGroupIndex].start
                    : 0,
                rangeEnd: boundaries.length > 0 && boundaries[startGroupIndex]
                    ? boundaries[startGroupIndex].start + accumulatedProducts.length
                    : accumulatedProducts.length,
                totalInPath: correctTotal,  // <-- Use correct total from boundaries
                hasMore: newHasMore || hasMoreProducts
            }
        );

        const totalCount = boundaries.length > 0 ? boundaries[boundaries.length - 1].end : 0;
        return {
            newStart: targetVirtualStart,
            products: productsToShow,
            total: totalCount,
            identifier,
            hasMore: targetVirtualEnd < totalCount
        };
    }

    // Initialize group boundaries
    private async initializeGroupBoundaries(params: NavigationParams): Promise<number> {
        const { identifier } = params;

        // Check if already initialized
        if (this.groupBoundaries.has(identifier)) {
            const boundaries = this.groupBoundaries.get(identifier)!;
            const lastBoundary = boundaries[boundaries.length - 1];
            return lastBoundary ? lastBoundary.end : 0;
        }

        const parsed = this.parseIdentifier(params.identifier, params);

        const cellId = await this.getActiveCloneCellId();
        const response = await this.store.client.callZome({
            cell_id: cellId,
            zome_name: "product_catalog",
            fn_name: "get_all_group_counts_for_path",
            payload: {
                category: parsed.category,
                subcategory: params.isProductType
                    ? params.selectedSubcategory
                    : parsed.isCompound
                        ? parsed.subcategory
                        : identifier,
                product_type: params.isProductType ? identifier : undefined
            }
        });

        let accumulatedCount = 0;
        let trueGrandTotalForPath = 0;
        const boundaries = response.map((count: any) => {
            const numericCount = Number(count) || 0;
            const boundary = {
                start: accumulatedCount,
                end: accumulatedCount + numericCount
            };
            accumulatedCount += numericCount;
            trueGrandTotalForPath += numericCount;
            return boundary;
        });

        this.groupBoundaries.set(identifier, boundaries);
        params.totalProducts[identifier] = trueGrandTotalForPath;
        return trueGrandTotalForPath;
    }

    // Fetch group data
    private async fetchGroup(
        params: NavigationParams,
        groupOffset: number,
        groupLimit: number = 1
    ): Promise<{
        products: ProductWithClientHash[];
        totalInPath: number;
        hasMore: boolean;
    }> {
        try {
            const parsed = this.parseIdentifier(params.identifier, params);

            const cellId = await this.getActiveCloneCellId();
            const response = await this.store.client.callZome({
                cell_id: cellId,
                zome_name: "product_catalog",
                fn_name: "get_products_by_category",
                payload: {
                    category: parsed.category,
                    subcategory: params.isProductType
                        ? params.selectedSubcategory
                        : parsed.isCompound
                            ? parsed.subcategory
                            : params.identifier,
                    product_type: params.isProductType ? params.identifier : undefined,
                    offset: groupOffset,
                    limit: groupLimit
                }
            });

            const products = this.extractProductsFromGroups(response.product_groups || []);
            const totalInPath = response.total_products || 0;
            const hasMoreResponse = response.has_more ?? false;

            return { products, totalInPath, hasMore: hasMoreResponse };
        } catch (fetchError) {
            console.error(`Error fetching groups from offset ${groupOffset}, limit ${groupLimit}:`, fetchError);
            return {
                products: [],
                totalInPath: params.totalProducts[params.identifier] || 0,
                hasMore: false
            };
        }
    }

    // Parse identifier helper
    private parseIdentifier(id: string, params: NavigationParams) {
        if (id && typeof id === "string" && id.includes("_")) {
            const parts = id.split("_");
            return {
                category: parts[0],
                subcategory: parts[1],
                isCompound: true
            };
        }
        return {
            category: params.category,
            subcategory: params.isProductType ? params.selectedSubcategory : params.identifier,
            isCompound: false
        };
    }

    // Core API fetch method
    private async fetchProductsFromApi(
        category: string,
        subcategory?: string,
        productType?: string,
        groupOffset: number = 0,
        groupLimit?: number
    ) {
        try {
            const fn_name = subcategory
                ? "get_products_by_category"
                : "get_all_category_products";

            const payload = subcategory
                ? {
                    category,
                    subcategory,
                    product_type: productType,
                    offset: groupOffset,
                    limit: groupLimit !== undefined ? groupLimit : 5,
                }
                : category;

            const response = await this.callZomeWithRetry(fn_name, payload);

            const products = this.extractProductsFromGroups(response.product_groups || []);
            const totalProducts = response.total_products || 0;
            const hasMore = response.has_more ?? false;

            return {
                products,
                total: totalProducts,
                name: subcategory,
                type: productType,
                hasMore,
            };
        } catch (error) {
            console.error("Error fetching products from API:", { category, subcategory, productType, groupOffset, groupLimit, error });
            return null;
        }
    }

    // Core method with cache invalidation and retry
    private async callZomeWithRetry(fn_name: string, payload: any, maxRetries: number = 2): Promise<any> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const cellId = await this.getActiveCloneCellId();
                console.log(`Calling zome (attempt ${attempt}):`, fn_name, 'with cell_id:', cellId[0].slice(0, 8) + '...');
                
                return await this.store.client.callZome({
                    cell_id: cellId,
                    zome_name: "product_catalog",
                    fn_name: fn_name,
                    payload: payload,
                });
            } catch (error: any) {
                console.error(`Zome call attempt ${attempt} failed:`, error);
                
                // Check if this looks like a clone/cell error
                const errorMsg = error?.message || error?.toString() || '';
                const isCloneError = errorMsg.includes('CellNotFound') || 
                                   errorMsg.includes('disabled') || 
                                   errorMsg.includes('clone') ||
                                   errorMsg.includes('Cell');
                
                if (isCloneError && attempt < maxRetries) {
                    console.log('🔄 Clone error detected - invalidating cache and retrying...');
                    this.cloneCache.clearCache();
                    continue;
                }
                
                // Re-throw error if max retries reached or not a clone error
                throw error;
            }
        }
    }

    // Loads initial products for a subcategory row (preview)
    async loadSubcategoryProducts(
        category: string,
        subcategory: string,
        containerCapacity: number
    ) {
        try {
            let groupLimit = 1;
            let result;

            while (true) {
                result = await this.fetchProductsFromApi(
                    category,
                    subcategory,
                    undefined,
                    0,
                    groupLimit
                );

                if (!result || !result.products || result.products.length >= containerCapacity || !result.hasMore) {
                    break;
                }

                groupLimit++;
            }

            return result;
        } catch (error) {
            console.error(`Error loading initial subcategory ${subcategory}:`, error);
            return null;
        }
    }

    // Loads products for a product type row (preview) or grid (all)
    async loadProductTypeProducts(
        category: string,
        subcategory: string,
        productType: string | null,
        isPreview: boolean = false,
        containerCapacity?: number
    ) {
        try {
            if (isPreview && containerCapacity !== undefined) {
                let groupLimit = 1;
                let result;

                while (true) {
                    result = await this.fetchProductsFromApi(
                        category,
                        subcategory,
                        productType || undefined,
                        0,
                        groupLimit
                    );

                    if (!result || !result.products || result.products.length >= containerCapacity || !result.hasMore) {
                        break;
                    }

                    groupLimit++;
                }

                return result;

            } else if (!isPreview) {
                const groupLimit = 1000;
                const result = await this.fetchProductsFromApi(
                    category,
                    subcategory,
                    productType || undefined,
                    0,
                    groupLimit
                );

                if (result) {
                    return result;
                }
                return null;
            }

        } catch (error) {
            console.error(`Error loading product type ${productType}:`, error);
            return null;
        }
    }

    // Loads all products for the main category grid
    async loadAllCategoryProducts(category: string) {
        try {
            const result = await this.fetchProductsFromApi(
                category,
                undefined,
                undefined,
                0,
                undefined
            );

            if (result) {
            }
            return result;

        } catch (error) {
            console.error(`Error loading all products for category ${category}:`, error);
            return null;
        }
    }

    // Navigation method for NavigationArrows - keeps original interface
    async loadProductsForNavigation(
        category: string,
        subcategory: string,
        productType: string | undefined,
        groupOffset: number,
        groupLimit: number,
        isProductType: boolean = false
    ) {
        try {
            const response = await this.fetchProductsFromApi(
                category,
                subcategory,
                productType,
                groupOffset,
                groupLimit
            );

            if (!response) {
                return { products: [], total: 0, hasMore: false };
            }

            if (!response.products || response.products.length === 0) {
                return { products: [], total: response.total || 0, hasMore: response.hasMore };
            }

            return {
                products: response.products,
                total: response.total || 0,
                hasMore: response.hasMore
            };
        } catch (error) {
            console.error("Error caught in loadProductsForNavigation wrapper:", error);
            return { products: [], total: 0, hasMore: false };
        }
    }
}

