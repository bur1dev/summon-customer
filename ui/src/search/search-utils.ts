// search-utils.ts
import { decode } from "@msgpack/msgpack";
import type { Product, SearchResult, RankedSearchResult } from "./search-types";
import { encodeHashToBase64 } from '@holochain/client';

// ==========================================
// Product Data Processing
// ==========================================

// +++ START OF ADDITION +++
export interface DecodedProductGroupEntry {
    products: Array<{
        // Define the properties you expect on each product *within the groupData*
        // This might be slightly different from your main 'Product' type if there's transformation
        name: string;
        category?: string;
        subcategory?: string;
        product_type?: string;
        price?: number;
        brand?: string; // Explicitly add brand
        is_organic?: boolean; // Add is_organic
        // Add any other fields that are directly in the decoded product object
        [key: string]: any; // If products can have arbitrary other fields
    }>;
    // Add other properties you expect on groupData itself, if any
    // For example: groupName?: string;
}
// +++ END OF ADDITION +++

/**
 * Decode products from ProductGroups
 */
export function decodeProducts(records: any[]): Product[] {
    const products: Product[] = [];

    for (const record of records) {
        try {
            const groupHash = record.signed_action.hashed.hash;
            // Convert Holochain hash to base64 string immediately for consistency
            const groupHashB64 = encodeHashToBase64(groupHash);
            
            // +++ MODIFICATION HERE +++
            const groupData = decode(record.entry.Present.entry) as DecodedProductGroupEntry | null;

            // Check if groupData is not null and has the products array
            if (groupData && groupData.products && Array.isArray(groupData.products)) {
                groupData.products.forEach((productDetails, index: number) => { // productDetails is now typed from DecodedProductGroupEntry.products
                    products.push({
                        ...productDetails, // Spread the fields from the decoded product
                        hash: {
                            groupHash: groupHashB64,  // Use base64 string for consistency
                            index,
                            toString: function () {
                                return `${this.groupHash}:${this.index}`;  // Now always base64 string
                            }
                        }
                    } as Product); // Assert that the final object matches the Product interface
                });
            }
        } catch (error) {
            console.error("Error decoding product group:", error);
        }
    }

    return products;
}

/**
 * Deduplicate products based on composite hash value
 */
export function deduplicateProducts(products: Product[] | null | undefined): Product[] {
    if (!products || !Array.isArray(products)) {
        return [];
    }

    const uniqueMap = new Map<string, Product>();

    for (const product of products) {
        // Skip invalid products
        if (!product || !product.hash) continue;

        try {
            // Use the composite hash for comparison
            const hashKey = product.hash.toString();
            if (!uniqueMap.has(hashKey)) {
                uniqueMap.set(hashKey, product);
            }
        } catch (error) {
            console.error("Error processing product during deduplication:", error);
        }
    }

    return Array.from(uniqueMap.values());
}

/**
 * Group related products by their relationship to a reference product
 */
export function groupRelatedProducts(
    referenceProduct: Product,
    typeProducts: Product[],
    allProducts: Product[]
): {
    sameSubcategoryProducts: Product[],
    sameCategoryProducts: Product[],
    otherProducts: Product[]
} {
    // Create set of hash keys for type products
    const typeProdHashes = new Set(typeProducts.map(p => p.hash.toString()));
    const refHashStr = referenceProduct.hash.toString();

    // Filter out products already in typeProducts or the reference product
    const otherMatchedProducts = allProducts.filter(p =>
        p.hash.toString() !== refHashStr &&
        !typeProdHashes.has(p.hash.toString())
    );

    // Group by category relationship
    const sameSubcategoryProducts = otherMatchedProducts.filter(p =>
        p.subcategory &&
        referenceProduct.subcategory &&
        p.subcategory === referenceProduct.subcategory
    );

    const sameCategoryProducts = otherMatchedProducts.filter(p =>
        p.category &&
        referenceProduct.category &&
        p.category === referenceProduct.category &&
        (!p.subcategory ||
            !referenceProduct.subcategory ||
            p.subcategory !== referenceProduct.subcategory)
    );

    const otherProducts = otherMatchedProducts.filter(p =>
        !p.category ||
        !referenceProduct.category ||
        p.category !== referenceProduct.category
    );

    return {
        sameSubcategoryProducts,
        sameCategoryProducts,
        otherProducts
    };
}

/**
 * Parse a query into main terms and qualifiers
 */
export function parseQuery(query: string): { mainTerms: string[], qualifiers: string[] } {
    const COMMON_QUALIFIERS = [
        "organic", "fresh", "large", "small", "red", "green",
        "frozen", "canned", "seedless", "ripe", "raw",
        "low-fat", "whole", "sliced", "diced", "natural"
    ];

    const terms = query.toLowerCase().split(/\s+/);
    const qualifiers = terms.filter(term => COMMON_QUALIFIERS.includes(term));
    const mainTerms = terms.filter(term => !COMMON_QUALIFIERS.includes(term));

    return { mainTerms, qualifiers };
}

/**
 * Combine semantic and text-based search results
 * @param semanticResults Results from semantic search
 * @param textResults Results from text search (e.g., Fuse.js)
 * @param blendFactor Weight given to semantic results (0-1)
 */
export function blendSearchResults(
    semanticResults: RankedSearchResult[],
    textResults: SearchResult<Product>[],
    blendFactor: number = 0.7,
    limit: number = 100
): Product[] {
    if (semanticResults.length === 0) return textResults.map(r => r.item);
    if (textResults.length === 0) return semanticResults.map(r => r.product);

    // Create maps for quick lookup
    const semanticMap = new Map<string, RankedSearchResult>();
    semanticResults.forEach(result => {
        semanticMap.set(result.product.hash.toString(), result);
    });

    const textMap = new Map<string, SearchResult<Product>>();
    textResults.forEach(result => {
        textMap.set(result.item.hash.toString(), result);
    });

    // Combine all unique products
    const allHashKeys = new Set([
        ...semanticMap.keys(),
        ...textMap.keys()
    ]);

    // Calculate blended scores
    const blendedResults: Array<{ product: Product, blendedScore: number }> = [];

    allHashKeys.forEach(hashKey => {
        const semanticResult = semanticMap.get(hashKey);
        const textResult = textMap.get(hashKey);

        let blendedScore = 1; // Default (worst) score

        if (semanticResult && textResult) {
            // Both results exist - blend scores
            blendedScore = (
                blendFactor * semanticResult.score +
                (1 - blendFactor) * (textResult.score || 1)
            );
        } else if (semanticResult) {
            // Only semantic result exists
            blendedScore = semanticResult.score;
        } else if (textResult) {
            // Only text result exists
            blendedScore = textResult.score || 1;
        }

        blendedResults.push({
            product: semanticResult?.product || textResult!.item,
            blendedScore
        });
    });

    // Sort by blended score (lower is better)
    blendedResults.sort((a, b) => a.blendedScore - b.blendedScore);

    // Return top products
    return blendedResults.slice(0, limit).map(r => r.product);
}

/**
 * Sort products by relevance to search query
 */
export function sortProductsByRelevance(products: Product[], searchTerm: string): void {
    const searchTermLower = searchTerm.toLowerCase();
    const searchTerms = searchTermLower.split(/\s+/);

    products.sort((a, b) => {
        // 1. Exact brand match
        const aBrand = a.name.split("®")[0].toLowerCase();
        const bBrand = b.name.split("®")[0].toLowerCase();
        const isAExactBrand = aBrand === searchTermLower;
        const isBExactBrand = bBrand === searchTermLower;

        if (isAExactBrand && !isBExactBrand) return -1;
        if (!isAExactBrand && isBExactBrand) return 1;

        // 2. Contains brand name
        const aHasBrand = aBrand.includes(searchTermLower) || searchTermLower.includes(aBrand);
        const bHasBrand = bBrand.includes(searchTermLower) || searchTermLower.includes(bBrand);

        if (aHasBrand && !bHasBrand) return -1;
        if (!aHasBrand && bHasBrand) return 1;

        // 3. Text similarity score
        const aMatches = (a.name.toLowerCase().match(new RegExp(searchTermLower, "g")) || []).length;
        const bMatches = (b.name.toLowerCase().match(new RegExp(searchTermLower, "g")) || []).length;

        return bMatches - aMatches;
    });
}

/**
 * Sort products by brand match
 */
export function sortProductsByBrand(products: Product[], brandName: string): void {
    if (!brandName) return;

    products.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();

        // Check if products match the brand
        const aMatchesBrand = aName.includes(brandName.toLowerCase());
        const bMatchesBrand = bName.includes(brandName.toLowerCase());

        if (aMatchesBrand && !bMatchesBrand) return -1;
        if (!aMatchesBrand && bMatchesBrand) return 1;

        return 0;
    });
}
