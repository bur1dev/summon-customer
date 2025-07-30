<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from "svelte";
    import { debounce, throttle } from "lodash";
    import MiniSearch from "minisearch";
    import { Search } from "lucide-svelte";
    import SearchCacheService from "../services/SearchCacheService";
    import type { Product, ProductTypeGroup } from "../types/search-types";
    import { clickable } from "../../shared/actions/clickable";
    import { parseQuery } from "../utils/search-utils";
    import { SearchApiClient } from "../utils/search-api";
    import {
        SearchStrategyFactory,
        HybridDropdownStrategy,
    } from "../utils/search-strategy";
    import { embeddingService } from "../services/EmbeddingService";
    import {
        isAmbiguousSingleFoodTerm,
        generateExpandedQueriesForAmbiguity,
    } from "../utils/query-utils";

    const dispatch = createEventDispatcher();

    // Props
    export let client: any = null;

    let searchQuery = "";
    let showDropdown = false;
    let searchResultsForDropdown: Array<Product | ProductTypeGroup> = [];
    let initialResultsForDropdown: Array<Product | ProductTypeGroup> = [];
    let semanticResultsLoading = false;
    let isLoading = false;
    let productIndex: Product[] = [];
    let miniSearch: MiniSearch;
    let apiClient: SearchApiClient;

    // Initialization state
    let isIndexAvailable = false;

    // Embedding state
    let queryEmbeddingCache = new Map<string, Float32Array>();
    let lastQueryForEmbedding = "";
    let currentQueryEmbedding: Float32Array | null = null;
    let searchInputRect: DOMRect | null = null;
    let searchInputElement: HTMLElement;
    let currentEmbeddingPromise: Promise<Float32Array | null> | null = null;

    let latestPreFilteredCandidates: Product[] = [];
    let latestCandidateIndices: number[] = [];
    let currentResults: Product[] = [];

    // Constants
    const DROPDOWN_RESULTS_LIMIT = 15;
    const PRE_FILTER_LIMIT = 200;
    const MINIMUM_QUERY_LENGTH_FOR_EMBEDDING = 4;
    const MINIMUM_KEYSTROKE_INTERVAL = 400;
    const MIN_QUERY_LENGTH = 3;

    function portal(node: HTMLElement) {
        let target = document.body;
        function update() {
            target.appendChild(node);
        }
        function destroy() {
            if (node.parentNode) node.parentNode.removeChild(node);
        }
        update();
        return { update, destroy };
    }

    function updateDropdownPosition() {
        if (searchInputElement) {
            searchInputRect = searchInputElement.getBoundingClientRect();
        }
    }

    const miniSearchOptions = {
        fields: ['name', 'brand', 'product_type', 'category', 'subcategory'],
        storeFields: ['name', 'brand', 'product_type', 'category', 'subcategory', 'price', 'image_url', 'hash'],
        searchOptions: {
            boost: { name: 2.0, brand: 1.5, product_type: 1.0, category: 0.8, subcategory: 0.8 },
            fuzzy: 0.2,
            prefix: true
        }
    };

    onMount(() => {
        const initialize = async () => {
            try {
                // Initializing search bar with auto-detection
                isLoading = true;

                // Create store object with the expected structure
                const store = { service: { client } };
                apiClient = new SearchApiClient(store);

                // Initialize embedding service for query embeddings
                await initializeEmbeddingService();

                // AUTO-INITIALIZATION: Smart Agent 1/2+ detection and setup
                const { autoInitializeSearch } = await import("../index");
                const initResult = await autoInitializeSearch(
                    store,
                    (progress) => {
                        console.log(`[SearchBar] ${progress.message}`);
                    },
                );

                console.log(
                    `[SearchBar] Auto-initialization: ${initResult.agent} - ${initResult.action}`,
                );

                // Try to load products after auto-initialization
                const products = await SearchCacheService.getSearchIndex(store);

                if (products.length === 0) {
                    console.log(
                        "[SearchBar] No search index available after auto-initialization",
                    );
                    isIndexAvailable = false;
                } else {
                    console.log(
                        `[SearchBar] Search index ready with ${products.length} products`,
                    );
                    initializeProductIndex(products);
                    isIndexAvailable = true;
                }
            } catch (error) {
                console.error(
                    "[SearchBar] Error during initialization:",
                    error,
                );
                isIndexAvailable = false;
            } finally {
                isLoading = false;
            }
        };

        initialize();

        window.addEventListener("resize", updateDropdownPosition);
        return () => {
            window.removeEventListener("resize", updateDropdownPosition);
        };
    });

    onDestroy(() => {
        // Cleanup if needed
    });

    async function initializeEmbeddingService() {
        try {
            await embeddingService.initialize();
            // Embedding service initialized
        } catch (error) {
            console.error(
                "[SearchBar] Error initializing embedding service:",
                error,
            );
        }
    }

    // Process products from SearchCacheService (embeddings already guaranteed as Float32Array)
    function initializeProductIndex(products: any[]) {
        // SearchCacheService returns ProcessedProduct[] which is compatible with our needs
        productIndex = products; // SearchCacheService guarantees proper embedding format

        // Product index initialized
        initMiniSearch(productIndex.filter((p) => p.name));
    }

    function initMiniSearch(products: Product[]) {
        if (products.length > 0) {
            miniSearch = new MiniSearch(miniSearchOptions);
            
            // Add products with numeric IDs that map to array indices
            const documentsForSearch = products.map((product, index) => ({
                id: index,
                ...product
            }));
            
            miniSearch.addAll(documentsForSearch);
            console.log(`[SearchBar] MiniSearch initialized with ${products.length} products`);
        } else {
            console.warn(
                "[SearchBar] No products available for MiniSearch initialization",
            );
        }
    }

    // Helper function to convert MiniSearch results to expected format
    function performMiniSearchQuery(query: string, limit?: number): Array<{item: Product, refIndex: number, score?: number}> {
        if (!miniSearch) return [];
        
        const results = miniSearch.search(query, {
            boost: { name: 2.0, brand: 1.5, product_type: 1.0, category: 0.8, subcategory: 0.8 },
            fuzzy: 0.2,
            prefix: true
        }).slice(0, limit || PRE_FILTER_LIMIT);
        
        return results.map(result => ({
            item: productIndex[result.id], // Map back to original product
            refIndex: result.id,           // Use ID as refIndex for HNSW compatibility
            score: result.score            // MiniSearch score (higher is better)
        }));
    }

    const getQueryEmbedding = async (
        query: string,
    ): Promise<Float32Array | null> => {
        if (!query || query.length < MINIMUM_QUERY_LENGTH_FOR_EMBEDDING) {
            return null;
        }

        if (queryEmbeddingCache.has(query)) {
            return queryEmbeddingCache.get(query)!;
        }

        try {
            const embedding = await embeddingService.getQueryEmbedding(query);
            if (!embedding) {
                console.warn(
                    `[SearchBar] No embedding returned for query: "${query}"`,
                );
                return null;
            }

            if (queryEmbeddingCache.size > 100) {
                const keysToDelete = Array.from(
                    queryEmbeddingCache.keys(),
                ).slice(0, 20);
                keysToDelete.forEach((key) => queryEmbeddingCache.delete(key));
            }
            queryEmbeddingCache.set(query, embedding);
            return embedding;
        } catch (error) {
            console.error(
                `[SearchBar] Error generating embedding for "${query}":`,
                error,
            );
            return null;
        }
    };

    const calculateQueryEmbedding = throttle(async () => {
        if (
            searchQuery === lastQueryForEmbedding ||
            searchQuery.length < MINIMUM_QUERY_LENGTH_FOR_EMBEDDING
        ) {
            return;
        }

        lastQueryForEmbedding = searchQuery;
        semanticResultsLoading = true;

        try {
            currentEmbeddingPromise = getQueryEmbedding(searchQuery);
            currentQueryEmbedding = await currentEmbeddingPromise;

            if (
                showDropdown &&
                searchQuery.trim() &&
                searchQuery === lastQueryForEmbedding
            ) {
                enhanceDropdownResults();
            }
        } catch (error) {
            console.error("[SearchBar] Error calculating embedding:", error);
            currentQueryEmbedding = null;
        } finally {
            semanticResultsLoading = false;
        }
    }, MINIMUM_KEYSTROKE_INTERVAL);

    async function enhanceDropdownResults() {
        if (
            !currentQueryEmbedding ||
            !initialResultsForDropdown.length ||
            !showDropdown
        )
            return;

        try {
            const preFilteredProducts =
                latestPreFilteredCandidates.length > 0
                    ? latestPreFilteredCandidates
                    : initialResultsForDropdown
                          .filter((item) => !item.isType)
                          .map((item) => item as Product);

            // Get corresponding candidate indices
            const candidateIndices =
                latestPreFilteredCandidates.length > 0
                    ? latestCandidateIndices
                    : []; // Fallback for initialResultsForDropdown case

            if (preFilteredProducts.length < 3) return;

            const strategy = new HybridDropdownStrategy(
                searchQuery,
                preFilteredProducts,
                currentQueryEmbedding,
                DROPDOWN_RESULTS_LIMIT,
                candidateIndices,
            );

            const result = await strategy.execute();

            if (showDropdown && searchQuery === lastQueryForEmbedding) {
                searchResultsForDropdown =
                    result.groupedResults || initialResultsForDropdown;
            }
        } catch (error) {
            console.error(
                "[SearchBar] Error enhancing dropdown results:",
                error,
            );
        }
    }

    const debouncedSearchForDropdown = debounce(async () => {
        if (!searchQuery.trim() || searchQuery.length < MIN_QUERY_LENGTH) {
            searchResultsForDropdown = [];
            initialResultsForDropdown = [];
            showDropdown = false;
            return;
        }

        if (!isIndexAvailable || !miniSearch || productIndex.length === 0) {
            console.warn("[SearchBar] Search unavailable - no index or MiniSearch");
            return;
        }

        isLoading = true;

        try {
            const { mainTerms, qualifiers } = parseQuery(searchQuery);
            const mainQuery = mainTerms.join(" ");

            console.time("MiniSearch search");
            const miniSearchResultsRaw = performMiniSearchQuery(mainQuery || searchQuery);
            console.timeEnd("MiniSearch search");

            const preFilteredCandidates = miniSearchResultsRaw
                .slice(0, PRE_FILTER_LIMIT)
                .map((r) => r.item);

            const candidateIndices = miniSearchResultsRaw
                .slice(0, PRE_FILTER_LIMIT)
                .map((r) => r.refIndex);

            latestPreFilteredCandidates = preFilteredCandidates;
            latestCandidateIndices = candidateIndices; // Store for HNSW filtering

            initialResultsForDropdown = processSearchResultsForDropdown(
                miniSearchResultsRaw,
                qualifiers,
            );

            // Don't immediately show MiniSearch results - wait for HNSW enhancement
            showDropdown = initialResultsForDropdown.length > 0;

            if (showDropdown) updateDropdownPosition();

            if (searchQuery.length >= MINIMUM_QUERY_LENGTH_FOR_EMBEDDING) {
                calculateQueryEmbedding();
            } else {
                // Fallback: show MiniSearch results if query too short for embeddings
                searchResultsForDropdown = initialResultsForDropdown;
            }
        } catch (error) {
            console.error("[SearchBar] Search error for dropdown:", error);
            searchResultsForDropdown = [];
            initialResultsForDropdown = [];
            showDropdown = false;
        } finally {
            isLoading = false;
        }
    }, 100);

    function processSearchResultsForDropdown(
        searchResults: Array<{item: Product, refIndex: number, score?: number}>,
        qualifiers: string[],
    ): Array<Product | ProductTypeGroup> {
        const searchLower = searchQuery.toLowerCase();
        const searchTerms = searchLower.split(/\s+/);
        searchResults.sort((a, b) =>
            sortResultsByRelevanceForDropdown(a, b, searchTerms, qualifiers),
        );

        const productTypeMap = new Map<string, ProductTypeGroup>();
        const specificProducts: Product[] = [];

        searchResults.forEach((result) => {
            if (result.item.product_type) {
                const type = result.item.product_type;
                if (!productTypeMap.has(type)) {
                    productTypeMap.set(type, {
                        type,
                        count: 1,
                        sample: result.item,
                        isType: true,
                    });
                } else {
                    productTypeMap.get(type)!.count += 1;
                }
            }
        });

        specificProducts.push(
            ...searchResults
                .slice(0, 10)
                .map(
                    (result) => ({ ...result.item, isType: false }) as Product,
                ),
        );

        const typeEntries = Array.from(productTypeMap.values())
            .filter((entry) => entry.count >= 2)
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);

        const isGenericSearch = searchQuery.trim().split(/\s+/).length === 1;

        if (isGenericSearch && typeEntries.length > 1) {
            return [...typeEntries, ...specificProducts].slice(
                0,
                DROPDOWN_RESULTS_LIMIT,
            );
        } else {
            return [...specificProducts, ...typeEntries].slice(
                0,
                DROPDOWN_RESULTS_LIMIT,
            );
        }
    }

    function sortResultsByRelevanceForDropdown(
        a: {item: Product, refIndex: number, score?: number},
        b: {item: Product, refIndex: number, score?: number},
        searchTerms: string[],
        qualifiers: string[],
    ): number {
        const aType = (a.item.product_type || "").toLowerCase();
        const bType = (b.item.product_type || "").toLowerCase();
        const aName = a.item.name.toLowerCase();
        const bName = b.item.name.toLowerCase();
        const searchLower = searchTerms.join(" ");

        if (aType === searchLower && bType !== searchLower) return -1;
        if (aType !== searchLower && bType === searchLower) return 1;

        const aTypeMatch = searchTerms.some((term) => aType.includes(term));
        const bTypeMatch = searchTerms.some((term) => bType.includes(term));

        if (aTypeMatch && !bTypeMatch) return -1;
        if (!aTypeMatch && bTypeMatch) return 1;

        const aExactMatch = searchTerms.some(
            (term) =>
                aName.includes(` ${term} `) ||
                aName.startsWith(`${term} `) ||
                aName.endsWith(` ${term}`) ||
                aName === term,
        );

        const bExactMatch = searchTerms.some(
            (term) =>
                bName.includes(` ${term} `) ||
                bName.startsWith(`${term} `) ||
                bName.endsWith(` ${term}`) ||
                bName === term,
        );

        if (aExactMatch && !bExactMatch) return -1;
        if (!aExactMatch && bExactMatch) return 1;

        if (qualifiers.length > 0) {
            const aMatchesQualifier = qualifiers.some((q) => aName.includes(q));
            const bMatchesQualifier = qualifiers.some((q) => bName.includes(q));
            if (aMatchesQualifier && !bMatchesQualifier) return -1;
            if (!aMatchesQualifier && bMatchesQualifier) return 1;
        }

        return (b.score ?? 0) - (a.score ?? 0); // MiniSearch: higher score is better
    }

    function handleInput() {
        if (currentEmbeddingPromise) {
            calculateQueryEmbedding.cancel();
        }
        debouncedSearchForDropdown();
    }

    function selectProduct(product: Product) {
        showDropdown = false;
        currentResults = [];

        if (miniSearch) {
            currentResults = performMiniSearchQuery(searchQuery).map((r) => r.item);
        }

        if (
            !currentResults.some(
                (p) => p.hash.toString() === product.hash.toString(),
            )
        ) {
            currentResults.unshift(product);
        }

        // Dispatching search results

        dispatch("select", {
            hash: product.hash,
            productName: product.name,
            originalQuery: searchQuery,
            category: product.category,
            subcategory: product.subcategory,
            product_type: product.product_type,
            searchResults: currentResults,
            searchMethod: "product_selection",
        });
    }

    const executeSemanticSearch = async () => {
        if (!searchQuery.trim()) {
            return;
        }

        if (!isIndexAvailable) {
            console.warn("[SearchBar] Search unavailable - no index");
            dispatch("viewAll", {
                query: searchQuery,
                searchResults: [],
                isViewAll: true,
                searchMethod: "text",
            });
            return;
        }

        isLoading = true;
        console.log(
            `[SearchBar] Performing semantic search for: "${searchQuery}"`,
        );
        console.time(`[SearchBar PSS] Total for "${searchQuery}"`);

        try {
            console.time(
                `[SearchBar PSS] Query Embedding for "${searchQuery}"`,
            );

            let queryEmbedding: Float32Array | null = null;
            const normalizedSearchQuery = searchQuery.trim().toLowerCase();

            if (isAmbiguousSingleFoodTerm(normalizedSearchQuery)) {
                console.log(
                    `[SearchBar PSS] Detected ambiguous term: "${normalizedSearchQuery}"`,
                );
                const expandedQueries = generateExpandedQueriesForAmbiguity(
                    normalizedSearchQuery,
                );
                console.log(
                    `[SearchBar PSS] Expanded queries: ${JSON.stringify(expandedQueries)}`,
                );
                queryEmbedding =
                    await embeddingService.getAverageEmbedding(expandedQueries);
                if (!queryEmbedding) {
                    console.warn(
                        `[SearchBar PSS] Failed to generate averaged embedding, falling back`,
                    );
                    queryEmbedding = await embeddingService.getQueryEmbedding(
                        normalizedSearchQuery,
                    );
                }
            } else {
                queryEmbedding = await embeddingService.getQueryEmbedding(
                    normalizedSearchQuery,
                );
            }

            console.timeEnd(
                `[SearchBar PSS] Query Embedding for "${searchQuery}"`,
            );

            if (!queryEmbedding) {
                console.warn(
                    `[SearchBar PSS] Unable to generate embedding, falling back to text`,
                );
                const textResults = miniSearch
                    ? performMiniSearchQuery(searchQuery).map((r) => r.item)
                    : [];
                dispatch("viewAll", {
                    query: searchQuery,
                    searchResults: textResults,
                    isViewAll: true,
                    searchMethod: "text",
                });
                console.timeEnd(`[SearchBar PSS] Total for "${searchQuery}"`);
                isLoading = false;
                return;
            }

            console.time(
                `[SearchBar PSS] MiniSearch Text Search for "${searchQuery}"`,
            );
            const textResults = miniSearch
                ? performMiniSearchQuery(searchQuery).map((r) => r.item)
                : [];
            console.timeEnd(
                `[SearchBar PSS] MiniSearch Text Search for "${searchQuery}"`,
            );

            const strategy = SearchStrategyFactory.createStrategy({
                searchMethod: "semantic",
                query: searchQuery,
                queryEmbedding,
                productIndex: productIndex,
                searchResults: textResults,
                apiClient: apiClient,
            });

            console.time(
                `[SearchBar PSS] Strategy Execute for "${searchQuery}"`,
            );
            const result = await strategy.execute();
            console.timeEnd(
                `[SearchBar PSS] Strategy Execute for "${searchQuery}"`,
            );

            dispatch("viewAll", {
                query: searchQuery,
                searchResults: result.products,
                isViewAll: true,
                searchMethod: "semantic",
            });
        } catch (error) {
            console.error(
                `[SearchBar PSS] Error during semantic search:`,
                error,
            );
            dispatch("viewAll", {
                query: searchQuery,
                searchResults: [],
                isViewAll: true,
                searchMethod: "semantic",
            });
        } finally {
            isLoading = false;
            console.timeEnd(`[SearchBar PSS] Total for "${searchQuery}"`);
        }
    };

    const performSemanticSearch = debounce(executeSemanticSearch, 700);

    function handleViewAllResults() {
        // View all results clicked
        performSemanticSearch.cancel();
        performSemanticSearch();
        showDropdown = false;
    }

    function handleTypeSelection(typeItem: ProductTypeGroup) {
        showDropdown = false;
        // Type selected

        if (miniSearch && typeItem.type) {
            const textResults = performMiniSearchQuery(typeItem.type)
                .filter((r) => r.item.product_type === typeItem.type)
                .map((r) => r.item);

            const strategy = SearchStrategyFactory.createStrategy({
                searchMethod: "minisearch_type_selection",
                query: searchQuery,
                searchResults: textResults,
            });

            strategy.execute().then((result) => {
                dispatch("viewAll", {
                    query: searchQuery,
                    searchResults: result.products,
                    isViewAll: true,
                    selectedType: typeItem.type,
                    searchMethod: "minisearch_type_selection",
                });
            });
        }
    }

    function handleEnterKey() {
        if (searchQuery.trim()) {
            // Enter key pressed for search
            debouncedSearchForDropdown.cancel();
            performSemanticSearch.cancel();
            executeSemanticSearch();
        }
        showDropdown = false;
    }

    function handleClickType(item: Product | ProductTypeGroup) {
        if ("type" in item && "sample" in item) {
            handleTypeSelection(item as ProductTypeGroup);
        }
    }

    function handleClickProduct(item: Product | ProductTypeGroup) {
        if ("name" in item && "hash" in item) {
            selectProduct(item as Product);
        }
    }
</script>

<div class="search-container">
    <div class="search-input-container" bind:this={searchInputElement}>
        <div class="search-icon">
            <Search size={18} color="#666666" />
        </div>
        <input
            type="text"
            placeholder={isIndexAvailable
                ? "Search products..."
                : "Search unavailable - no index"}
            bind:value={searchQuery}
            on:input={handleInput}
            on:click={() => {
                if (searchQuery.trim() && !showDropdown)
                    debouncedSearchForDropdown();
            }}
            on:focus={() => {
                if (searchQuery.trim() && !showDropdown)
                    debouncedSearchForDropdown();
            }}
            on:keydown={(e) => {
                if (e.key === "Enter" && searchQuery.trim()) {
                    handleEnterKey();
                }
            }}
            disabled={!isIndexAvailable}
        />
        {#if isLoading || semanticResultsLoading}
            <div class="search-loading"></div>
        {/if}
    </div>

    {#if showDropdown && isIndexAvailable}
        <div
            class="search-overlay"
            use:clickable={() => (showDropdown = false)}
            use:portal
        ></div>

        <div
            class="search-dropdown"
            use:portal
            style="
                position: fixed; 
                top: {searchInputRect ? searchInputRect.bottom + 'px' : '0'};
                left: {searchInputRect ? searchInputRect.left + 'px' : '0'};
                width: {searchInputRect
                ? searchInputRect.width + 'px'
                : '100%'};
            "
        >
            <div class="results-container">
                {#if isLoading && searchResultsForDropdown.length === 0}
                    <div class="loading">Loading...</div>
                {:else if searchResultsForDropdown.length === 0}
                    <div class="no-results">No products found</div>
                {:else}
                    {#each searchResultsForDropdown as result}
                        {#if result.isType && "type" in result && "sample" in result}
                            <div
                                class="dropdown-item type-item"
                                use:clickable={() => handleClickType(result)}
                            >
                                <div class="product-image">
                                    {#if result.sample && "image_url" in result.sample && result.sample.image_url}
                                        <img
                                            src={result.sample.image_url}
                                            alt={result.type}
                                        />
                                    {/if}
                                </div>
                                <div class="product-name">
                                    <span class="product-type"
                                        >{result.type}</span
                                    >
                                    {searchQuery}
                                </div>
                            </div>
                        {:else if !result.isType && "name" in result && "price" in result}
                            <div
                                class="dropdown-item"
                                use:clickable={() => handleClickProduct(result)}
                            >
                                <div class="product-image">
                                    {#if "image_url" in result && result.image_url}
                                        <img
                                            src={result.image_url}
                                            alt={result.name}
                                        />
                                    {/if}
                                </div>
                                <div class="product-name">{result.name}</div>
                                <div class="product-price">
                                    ${typeof result.price === "number"
                                        ? result.price.toFixed(2)
                                        : "0.00"}
                                </div>
                            </div>
                        {/if}
                    {/each}
                {/if}
            </div>
            <div class="view-all" use:clickable={handleViewAllResults}>
                View all results
            </div>
        </div>
    {/if}
</div>

<style>
    .search-container {
        position: relative;
        width: 100%;
    }

    .search-input-container {
        position: relative;
        display: flex;
        align-items: center;
        width: 100%;
    }

    .search-icon {
        position: absolute;
        left: var(--spacing-md);
        display: flex;
        align-items: center;
        pointer-events: none;
        color: var(--text-secondary);
        z-index: 5;
    }

    .search-loading {
        position: absolute;
        right: var(--spacing-md);
        width: 16px;
        height: 16px;
        border: 2px solid rgba(0, 0, 0, 0.1);
        border-top: 2px solid var(--primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        0% {
            transform: rotate(0deg);
        }
        100% {
            transform: rotate(360deg);
        }
    }

    input {
        width: 100%;
        height: var(--btn-height-md);
        padding: var(--spacing-sm) var(--spacing-md) var(--spacing-sm)
            calc(var(--spacing-md) * 2 + 18px);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--btn-border-radius);
        font-size: var(--font-size-md);
        color: var(--text-primary);
        background-color: var(--surface);
        box-shadow: var(--shadow-subtle);
        transition: var(--btn-transition);
        box-sizing: border-box;
    }

    input:disabled {
        background-color: #f5f5f5;
        color: #999;
        cursor: not-allowed;
    }

    input:hover:not(:disabled) {
        border-color: var(--primary);
    }

    input:focus:not(:disabled) {
        border-color: var(--primary);
        box-shadow: var(--shadow-medium);
        outline: none;
    }

    .search-dropdown {
        max-height: 500px;
        background: var(--surface);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--card-border-radius);
        box-shadow: var(--shadow-medium);
        display: flex;
        flex-direction: column;
        z-index: var(--z-index-modal);
        animation: scaleIn var(--transition-fast) ease forwards;
        overflow: hidden;
    }

    .results-container {
        flex: 1;
        overflow-y: auto;
        max-height: 600px;
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }

    .results-container::-webkit-scrollbar {
        width: 6px;
    }

    .results-container::-webkit-scrollbar-track {
        background: var(--scrollbar-track);
    }

    .results-container::-webkit-scrollbar-thumb {
        background-color: var(--scrollbar-thumb);
        border-radius: 3px;
    }

    .search-overlay {
        position: fixed;
        top: var(--component-header-height);
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--overlay-dark);
        z-index: var(--z-index-sticky);
        animation: fadeIn var(--transition-fast) ease forwards;
    }

    .dropdown-item {
        display: flex;
        align-items: center;
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: var(--border-width-thin) solid var(--border-lighter);
        cursor: pointer;
        transition: background-color var(--transition-fast) ease;
    }

    .dropdown-item:hover {
        background-color: var(--surface-hover);
    }

    .product-image {
        width: 40px;
        height: 40px;
        min-width: 40px;
        margin-right: var(--spacing-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--background);
        border-radius: var(--card-border-radius);
    }

    .product-image img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    }

    .product-name {
        flex: 1;
        font-size: var(--font-size-md);
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .product-price {
        margin-left: var(--spacing-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        white-space: nowrap;
    }

    .view-all {
        padding: var(--spacing-md);
        text-align: center;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        color: var(--button-text);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition: var(--btn-transition);
    }

    .view-all:hover {
        background: linear-gradient(
            135deg,
            var(--primary-dark),
            var(--secondary)
        );
    }

    .type-item {
        background-color: var(--surface-hover);
    }

    .product-type {
        font-weight: var(--font-weight-semibold);
        color: var(--primary);
    }

    .loading,
    .no-results {
        padding: var(--spacing-lg);
        text-align: center;
        color: var(--text-secondary);
        font-size: var(--font-size-md);
    }
</style>
