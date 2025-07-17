import type { SearchApiClient } from "./search-api";
import {
    deduplicateProducts,
    groupRelatedProducts,
    sortProductsByRelevance,
    blendSearchResults
} from "./search-utils";
import type { Product, RankedSearchResult, SearchResult } from "./search-types";
import { embeddingService } from "./EmbeddingService"; // embeddingService now includes HNSW capabilities

/**
 * Base interface for all search strategies
 */
export interface SearchStrategy {
    execute(): Promise<{ products: Product[], total: number, groupedResults?: any[] }>;
}

/**
 * Strategy for when a specific product is selected
 */
export class ProductSelectionStrategy implements SearchStrategy {
    private apiClient: SearchApiClient;
    private productHash: any;
    private searchQuery: string;
    private searchResults: Product[];

    constructor(apiClient: SearchApiClient, productHash: any, searchQuery: string, searchResults: Product[] = []) {
        this.apiClient = apiClient;
        this.productHash = productHash;
        this.searchQuery = searchQuery;
        this.searchResults = searchResults;
    }

    async execute(): Promise<{ products: Product[], total: number }> {
        try {
            const matchingProducts = await this.apiClient.getAllProductVersionsByHash(this.productHash) || [];
            const currentSearchResults = this.searchResults || [];

            if (matchingProducts.length === 0) {
                return {
                    products: deduplicateProducts(currentSearchResults),
                    total: currentSearchResults.length
                };
            }

            const selectedProduct = matchingProducts[0];
            if (!selectedProduct) {
                return {
                    products: deduplicateProducts(currentSearchResults),
                    total: currentSearchResults.length
                };
            }

            if (selectedProduct.product_type) {
                return this.handleProductWithType(selectedProduct);
            } else {
                const hashStr = this.productHash.toString();
                const products = [
                    selectedProduct,
                    ...currentSearchResults.filter(p => p.hash.toString() !== hashStr)
                ];
                return {
                    products: deduplicateProducts(products),
                    total: products.length
                };
            }
        } catch (error) {
            console.error("Error in ProductSelectionStrategy:", error);
            return { products: [], total: 0 };
        }
    }

    private async handleProductWithType(selectedProduct: Product): Promise<{ products: Product[], total: number }> {
        try {
            if (!selectedProduct.category || !selectedProduct.subcategory || !selectedProduct.product_type) {
                throw new Error("Product missing category information");
            }

            const [sameTypeResult, subcategoryResult] = await Promise.all([
                this.apiClient.getProductsByType(
                    selectedProduct.category,
                    selectedProduct.subcategory,
                    selectedProduct.product_type
                ),
                this.apiClient.getAdditionalSubcategoryProducts(
                    selectedProduct.category,
                    selectedProduct.subcategory,
                    null,
                    100
                )
            ]);

            const sameTypeProducts = sameTypeResult.products;
            const subcategoryProducts = subcategoryResult || [];
            const relatedGroups = groupRelatedProducts(
                selectedProduct,
                sameTypeProducts,
                this.searchResults || []
            );

            if (this.searchQuery) {
                if (sameTypeProducts.length > 0) sortProductsByRelevance(sameTypeProducts, this.searchQuery);
                if (subcategoryProducts.length > 0) sortProductsByRelevance(subcategoryProducts, this.searchQuery);
            }

            const finalProducts = [
                selectedProduct,
                ...sameTypeProducts,
                ...subcategoryProducts,
                ...relatedGroups.sameSubcategoryProducts,
                ...relatedGroups.sameCategoryProducts,
                ...relatedGroups.otherProducts
            ];
            return {
                products: deduplicateProducts(finalProducts),
                total: finalProducts.length
            };
        } catch (error) {
            console.error("Error in handleProductWithType:", error);
            const hashStr = this.productHash.toString();
            const products = [
                selectedProduct,
                ...this.searchResults.filter(p => p.hash.toString() !== hashStr)
            ];
            return {
                products: deduplicateProducts(products),
                total: products.length
            };
        }
    }
}

/**
 * Strategy for semantic search using embeddings (now defaults to HNSW on main thread)
 */
export class SemanticSearchStrategy implements SearchStrategy {
    // apiClient might not be strictly needed if all products are local and embeddings are generated client-side or pre-loaded
    private apiClient: SearchApiClient;
    private queryEmbedding: number[] | Float32Array;
    private searchQuery: string;
    private allAvailableProducts: Product[]; // This should be the complete list of products for HNSW index building
    private textSearchResults: Product[]; // Optional: results from a text search (e.g., Fuse.js) for blending
    private limit: number;

    constructor(
        apiClient: SearchApiClient,
        queryEmbedding: number[] | Float32Array,
        searchQuery: string,
        allAvailableProducts: Product[],
        textSearchResults: Product[] = [],
        limit: number = 100
    ) {
        this.apiClient = apiClient;
        this.queryEmbedding = queryEmbedding;
        this.searchQuery = searchQuery;
        this.allAvailableProducts = allAvailableProducts;
        this.textSearchResults = textSearchResults;
        this.limit = limit;
    }

    async execute(): Promise<{ products: Product[], total: number }> {
        console.time(`[SemanticSearchStrategy EXECUTE] Total for "${this.searchQuery}"`);
        try {
            console.log(`[SemanticSearchStrategy] Executing HNSW semantic search for: "${this.searchQuery}"`);

            if (!this.queryEmbedding || this.queryEmbedding.length === 0) {
                console.warn(`[SemanticSearchStrategy] No valid query embedding for "${this.searchQuery}", falling back to text results.`);
                const productsToReturn = deduplicateProducts(this.textSearchResults);
                console.timeEnd(`[SemanticSearchStrategy EXECUTE] Total for "${this.searchQuery}"`); // Early exit
                return { products: productsToReturn, total: productsToReturn.length };
            }

            console.time(`[SemanticSearchStrategy EXECUTE] HNSW Prepare for "${this.searchQuery}"`);
            await embeddingService.prepareHnswIndex(this.allAvailableProducts, false, true); // Don't force rebuild, DO persist
            console.timeEnd(`[SemanticSearchStrategy EXECUTE] HNSW Prepare for "${this.searchQuery}"`);

            const queryEmbeddingF32 = this.queryEmbedding instanceof Float32Array
                ? this.queryEmbedding
                : new Float32Array(this.queryEmbedding);

            console.time(`[SemanticSearchStrategy EXECUTE] HNSW Rank (rankBySimilarityHNSW) for "${this.searchQuery}"`);
            const hnswRankings = await embeddingService.rankBySimilarityHNSW(
                queryEmbeddingF32,
                this.limit * 2 // Get more results from HNSW for better blending potential
            );
            console.timeEnd(`[SemanticSearchStrategy EXECUTE] HNSW Rank (rankBySimilarityHNSW) for "${this.searchQuery}"`);
            console.log(`[SemanticSearchStrategy] rankBySimilarityHNSW returned ${hnswRankings.length} items for "${this.searchQuery}".`);


            if (hnswRankings.length === 0) {
                console.log(`[SemanticSearchStrategy] No HNSW rankings returned for "${this.searchQuery}", falling back to text results.`);
                const productsToReturn = deduplicateProducts(this.textSearchResults);
                console.timeEnd(`[SemanticSearchStrategy EXECUTE] Total for "${this.searchQuery}"`); // Early exit
                return { products: productsToReturn, total: productsToReturn.length };
            }

            console.time(`[SemanticSearchStrategy EXECUTE] Map HNSW Rankings for "${this.searchQuery}"`);
            const semanticResultsForBlending: RankedSearchResult[] = hnswRankings.map(r => ({
                product: r.product,
                score: r.score,       // This is HNSW distance (lower is better)
                similarity: r.similarity // This is 1 - distance (higher is better)
            }));
            console.timeEnd(`[SemanticSearchStrategy EXECUTE] Map HNSW Rankings for "${this.searchQuery}"`);

            let finalProducts: Product[];
            console.time(`[SemanticSearchStrategy EXECUTE] Blending Logic for "${this.searchQuery}"`);
            if (this.textSearchResults && this.textSearchResults.length > 0) {
                console.time(`[SemanticSearchStrategy EXECUTE] Map Text Results for Blending for "${this.searchQuery}"`);
                const textResultsForBlending: SearchResult<Product>[] = this.textSearchResults.map(product => ({
                    item: product,
                    score: (product as any).score || 0.5 // Fuse.js score (lower is better), or default
                }));
                console.timeEnd(`[SemanticSearchStrategy EXECUTE] Map Text Results for Blending for "${this.searchQuery}"`);

                console.time(`[SemanticSearchStrategy EXECUTE] Actual Blending (blendSearchResults) for "${this.searchQuery}"`);
                finalProducts = blendSearchResults(
                    semanticResultsForBlending, // score is distance (lower = better)
                    textResultsForBlending,    // score is Fuse score (lower = better)
                    0.7,
                    this.limit
                );
                console.timeEnd(`[SemanticSearchStrategy EXECUTE] Actual Blending (blendSearchResults) for "${this.searchQuery}"`);
            } else {
                console.log(`[SemanticSearchStrategy] No text results to blend for "${this.searchQuery}", using HNSW results directly.`);
                finalProducts = semanticResultsForBlending.slice(0, this.limit).map(r => r.product);
            }
            console.timeEnd(`[SemanticSearchStrategy EXECUTE] Blending Logic for "${this.searchQuery}"`);

            console.time(`[SemanticSearchStrategy EXECUTE] Deduplicate Final Products for "${this.searchQuery}"`);
            const deduplicatedFinalProducts = deduplicateProducts(finalProducts);
            console.timeEnd(`[SemanticSearchStrategy EXECUTE] Deduplicate Final Products for "${this.searchQuery}"`);

            console.log(`[SemanticSearchStrategy] HNSW search produced ${deduplicatedFinalProducts.length} blended results for "${this.searchQuery}".`);
            console.timeEnd(`[SemanticSearchStrategy EXECUTE] Total for "${this.searchQuery}"`);
            return { products: deduplicatedFinalProducts, total: deduplicatedFinalProducts.length };

        } catch (error) {
            console.error(`[SemanticSearchStrategy EXECUTE] HNSW Error for "${this.searchQuery}":`, error);
            console.timeEnd(`[SemanticSearchStrategy EXECUTE] Total for "${this.searchQuery}"`); // Error exit
            const productsToReturn = deduplicateProducts(this.textSearchResults);
            return { products: productsToReturn, total: productsToReturn.length };
        }
    }
}

/**
 * Strategy for text-based search using provided results
 */
export class TextSearchStrategy implements SearchStrategy {
    private searchResults: Product[];
    private searchQuery: string;

    constructor(searchResults: Product[], searchQuery: string) {
        this.searchResults = searchResults || [];
        this.searchQuery = searchQuery;
    }

    async execute(): Promise<{ products: Product[], total: number }> {
        try {
            if (!this.searchResults || this.searchResults.length === 0) {
                return { products: [], total: 0 };
            }
            let processedResults = [...this.searchResults];
            if (this.searchQuery && processedResults.length > 0) {
                sortProductsByRelevance(processedResults, this.searchQuery);
            }
            const results = deduplicateProducts(processedResults);
            return { products: results, total: results.length };
        } catch (error) {
            console.error("[TextSearchStrategy] Error:", error);
            return { products: [], total: 0 };
        }
    }
}

/**
 * Optimized strategy for hybrid dropdown results that works with pre-filtered candidates.
 * This will also use HNSW for re-ranking if query embedding is available.
 */
export class HybridDropdownStrategy implements SearchStrategy {
    private searchQuery: string;
    private preFilteredCandidates: Product[];
    private queryEmbedding: Float32Array | null;
    private limit: number;

    constructor(
        searchQuery: string,
        preFilteredCandidates: Product[],
        queryEmbedding: Float32Array | null,
        limit: number = 15
    ) {
        this.searchQuery = searchQuery;
        this.preFilteredCandidates = preFilteredCandidates;
        this.queryEmbedding = queryEmbedding;
        this.limit = limit;
    }

    async execute(): Promise<{ products: Product[], total: number, groupedResults: any[] }> {
        try {
            let rerankedProducts: Product[] = [...this.preFilteredCandidates];

            if (this.queryEmbedding && this.preFilteredCandidates.length >= 3) {
                // Ensure HNSW index is prepared for these specific preFilteredCandidates
                // This will build a temporary HNSW index for the dropdown candidates.
                // For dropdown, we might not want to persist this specific small index.
                // The `prepareHnswIndex` currently saves, which might be too much for dropdowns.
                // A potential optimization: have a flag in prepareHnswIndex to not save.
                // For now, it will save 'hnsw_index_main.dat' which might get overwritten if full search happens next.
                // This needs careful consideration of index persistence strategy.
                // Let's assume for now we build it without trying to load/save for dropdown for simplicity,
                // meaning it's always rebuilt for the dropdown if an embedding exists.
                // OR, we make `prepareHnswIndex` smarter or add a separate method.

                // Simpler approach for dropdown: build a temporary index or use a different filename.
                // For this iteration, let's assume rankBySimilarityHNSW will build if needed using current logic.
                // The `prepareHnswIndex` call in SemanticSearchStrategy would build the main one.
                // If this strategy is called first, it might build using `hnsw_index_main.dat`.

                // To avoid issues with the main persisted index, let's make dropdown HNSW build specific to its candidates
                // and not rely on the global persisted index state directly for dropdowns.
                // This requires `embeddingService.rankBySimilarityHNSW` to be able to take `sourceProducts` directly for building.
                // The provided `EmbeddingService` was modified to build if `hnswIndexSourceProductsRef` differs.
                // So, if `prepareHnswIndex` is called with different `sourceProducts`, it will rebuild.

                // For dropdown, we want to use the `preFilteredCandidates` as the source for HNSW.
                await embeddingService.prepareHnswIndex(this.preFilteredCandidates, true, false); // Force rebuild, DO NOT persist

                const queryEmbeddingF32 = this.queryEmbedding instanceof Float32Array
                    ? this.queryEmbedding
                    : new Float32Array(this.queryEmbedding);

                const hnswRankings = await embeddingService.rankBySimilarityHNSW(
                    queryEmbeddingF32,
                    // sourceProducts are handled by the prepareHnswIndex call above
                    this.preFilteredCandidates.length // Rank all candidates
                );

                if (hnswRankings.length > 0) {
                    rerankedProducts = hnswRankings.map(r => r.product);
                }
            }

            rerankedProducts = deduplicateProducts(rerankedProducts);
            const groupedResults = this.processResultsForDropdown(rerankedProducts);
            return {
                products: rerankedProducts.slice(0, this.limit),
                total: rerankedProducts.length,
                groupedResults
            };

        } catch (error) {
            console.error("[HybridDropdownStrategy] HNSW Error:", error);
            const grouped = this.processResultsForDropdown(this.preFilteredCandidates);
            return {
                products: this.preFilteredCandidates.slice(0, this.limit),
                total: this.preFilteredCandidates.length,
                groupedResults: grouped
            };
        }
    }

    private processResultsForDropdown(products: Product[]): any[] {
        const productTypeMap = new Map<string, any>();
        // const specificProducts: Product[] = []; // Not needed if we just use products directly

        products.forEach(product => {
            if (product.product_type) {
                const type = product.product_type;
                if (!productTypeMap.has(type)) {
                    productTypeMap.set(type, { type, count: 1, sample: product, isType: true });
                } else {
                    productTypeMap.get(type)!.count += 1;
                }
            }
        });

        // Use the (potentially re-ranked) products directly for "specific products"
        const specificProductItems = products.slice(0, 10).map(product => ({ ...product, isType: false }));

        const typeEntries = Array.from(productTypeMap.values())
            .filter(entry => entry.count >= 2)
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);

        const isGenericSearch = this.searchQuery.trim().split(/\s+/).length === 1;
        if (isGenericSearch && typeEntries.length > 1) {
            return [...typeEntries, ...specificProductItems].slice(0, this.limit);
        } else {
            return [...specificProductItems, ...typeEntries].slice(0, this.limit);
        }
    }
}


/**
 * Factory to create the appropriate search strategy based on context
 */
export class SearchStrategyFactory {
    static createStrategy(
        options: {
            apiClient?: SearchApiClient,
            searchMethod: string,
            query: string,
            productHash?: any,
            queryEmbedding?: number[] | Float32Array,
            productIndex?: Product[], // This is ALL available products from productCache
            searchResults?: Product[], // These are typically pre-filtered TEXT results from Fuse.js
            preFilteredCandidates?: Product[] // Specifically for dropdown from text search
        }
    ): SearchStrategy {
        const {
            apiClient,
            searchMethod,
            query,
            productHash,
            queryEmbedding,
            productIndex, // All products for SemanticSearchStrategy HNSW index
            searchResults, // Text results for blending or as primary for TextSearchStrategy
            preFilteredCandidates // Subset for HybridDropdownStrategy HNSW index
        } = options;

        switch (searchMethod) {
            case "semantic": // Full semantic search, potentially blended
                if (queryEmbedding && productIndex && apiClient) {
                    return new SemanticSearchStrategy(
                        apiClient,
                        queryEmbedding,
                        query,
                        productIndex, // Pass all products for HNSW index
                        searchResults || [], // Pass text results for blending
                        100
                    );
                }
                console.warn("[SearchStrategyFactory] Semantic search requirements not met, falling back.");
                return new TextSearchStrategy(searchResults || productIndex || [], query);


            case "text":
            case "fuse_type_selection":
                return new TextSearchStrategy(searchResults || [], query);

            case "product_selection":
                if (productHash && apiClient) {
                    return new ProductSelectionStrategy(
                        apiClient,
                        productHash,
                        query,
                        searchResults || []
                    );
                }
                console.warn("[SearchStrategyFactory] Product selection requirements not met, falling back.");
                return new TextSearchStrategy(searchResults || productIndex || [], query);

            case "hybrid_dropdown": // For dropdown re-ranking
                if (preFilteredCandidates && queryEmbedding) {
                    const embeddingForStrategy: Float32Array | null =
                        queryEmbedding instanceof Float32Array
                            ? queryEmbedding
                            : (Array.isArray(queryEmbedding) && queryEmbedding.length > 0
                                ? new Float32Array(queryEmbedding)
                                : null);

                    if (embeddingForStrategy) { // Only proceed if we have a valid Float32Array
                        return new HybridDropdownStrategy(
                            query,
                            preFilteredCandidates,
                            embeddingForStrategy,
                            15
                        );
                    }
                }
                // Fallback for dropdown if no valid embedding or preFilteredCandidates
                console.warn("[SearchStrategyFactory] Hybrid dropdown requirements not fully met (missing candidates or valid embedding after conversion), falling back to text search for dropdown.");
                return new TextSearchStrategy(preFilteredCandidates || [], query);


            default:
                console.warn(`[SearchStrategyFactory] Unknown search method: ${searchMethod}. Defaulting to text search.`);
                return new TextSearchStrategy(searchResults || productIndex || [], query);
        }
    }
}