// ProductRowCacheService.ts - Simple cache for product rows with 5-minute expiration

/**
 * Cache structure for product row data
 */
interface CachedProductData {
    products: any[];      // Full group of products (up to 100)
    timestamp: number;    // When this was cached
    rangeStart: number;   // Starting index of this cached range
    rangeEnd: number;     // Ending index of this cached range 
    totalInPath: number;  // Total count of products in this path
    hasMore: boolean;     // Whether there are more products beyond this group
    groupIndex: number;   // Group index for this cached data
}

/**
 * Cache key structure - no longer uses start index/capacity
 */
interface CacheKey {
    category: string;
    identifier: string;  // subcategory or productType
    isProductType: boolean;
    groupIndex: number;  // Store by group index instead of product indices
}

/**
 * Request key for looking up products
 */
interface CacheRequest {
    category: string;
    identifier: string;
    isProductType: boolean;
    startIndex: number;
    capacity: number;
}

/**
 * Service to cache product row data to reduce API calls
 */
export class ProductRowCacheService {
    private cache: Map<string, CachedProductData> = new Map();
    private readonly CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

    /**
     * Generate a unique cache key for the product row data
     */
    private generateCacheKey(key: CacheKey): string {
        return `${key.category}:${key.identifier}:${key.isProductType}:${key.groupIndex}`;
    }

    /**
     * Store full product group in cache
     */
    public setCacheGroup(
        category: string,
        identifier: string,
        isProductType: boolean,
        groupIndex: number,
        data: {
            products: any[];
            rangeStart: number;
            rangeEnd: number;
            totalInPath: number;
            hasMore: boolean;
        }
    ): void {
        const key = this.generateCacheKey({
            category,
            identifier,
            isProductType,
            groupIndex
        });

        console.log(`🔵 Cache: Storing GROUP #${groupIndex} with ${data.products.length} products for ${identifier}, range ${data.rangeStart}-${data.rangeEnd}`);

        this.cache.set(key, {
            products: data.products,
            timestamp: Date.now(),
            rangeStart: data.rangeStart,
            rangeEnd: data.rangeEnd,
            totalInPath: data.totalInPath,
            hasMore: data.hasMore,
            groupIndex
        });
    }

    /**
     * Get cached product slice if available and not expired
     */
    public getProductsInRange(request: CacheRequest): {
        products: any[];
        totalInPath: number;
        hasMore: boolean;
        fromCache: boolean;
    } | null {
        // Find all cache entries that match the category and identifier
        const matchingEntries: CachedProductData[] = [];

        // Search through all cache entries
        for (const [key, entry] of this.cache.entries()) {
            // Check if the key matches our category and identifier
            if (key.startsWith(`${request.category}:${request.identifier}:${request.isProductType}`)) {
                // Check if cache has expired
                if (Date.now() - entry.timestamp > this.CACHE_EXPIRY_MS) {
                    console.log(`🔵 Cache: EXPIRED for ${request.identifier} - group #${entry.groupIndex}`);
                    this.cache.delete(key);
                    continue;
                }

                matchingEntries.push(entry);
            }
        }

        if (matchingEntries.length === 0) {
            console.log(`🔵 Cache: MISS for ${request.identifier} at index ${request.startIndex} - no matching groups`);
            return null;
        }

        // Check if any of the matching entries contain our requested range
        for (const entry of matchingEntries) {
            const requestEnd = request.startIndex + request.capacity;

            // If the requested range is fully contained in this cached entry
            if (request.startIndex >= entry.rangeStart && requestEnd <= entry.rangeEnd) {
                // Calculate slice indices within this cached group
                const sliceStart = request.startIndex - entry.rangeStart;
                const sliceEnd = sliceStart + request.capacity;

                // Extract just the products we need
                const products = entry.products.slice(sliceStart, sliceEnd);

                console.log(`🔵 Cache: HIT for ${request.identifier} at index ${request.startIndex} - using ${products.length} products from group #${entry.groupIndex}`);

                return {
                    products,
                    totalInPath: entry.totalInPath,
                    hasMore: entry.hasMore,
                    fromCache: true
                };
            }
        }

        console.log(`🔵 Cache: MISS for ${request.identifier} at index ${request.startIndex} - range not in any cached group`);
        return null;
    }

    /**
     * Clear all cached data
     */
    public clearAllCache(): void {
        console.log(`🔵 Cache: Cleared all cached data (${this.cache.size} entries)`);
        this.cache.clear();
    }

    /**
     * Clear cached data for a specific category
     */
    public clearCategoryCache(category: string): void {
        let clearedCount = 0;

        // Find and delete all entries that match the category
        for (const key of this.cache.keys()) {
            if (key.startsWith(`${category}:`)) {
                this.cache.delete(key);
                clearedCount++;
            }
        }

        console.log(`🔵 Cache: Cleared ${clearedCount} entries for category ${category}`);
    }

    /**
     * Get cache stats for debugging
     */
    public getStats(): { size: number, keys: string[] } {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}