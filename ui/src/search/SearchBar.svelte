<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from "svelte";
    import { debounce, throttle } from "lodash";
    import Fuse, { type FuseResult } from "fuse.js";
    import { Search } from "lucide-svelte";
    import SearchCacheService from "./SearchCacheService";
    import type {
        Product,
        ProductTypeGroup,
        CompositeHash,
        SearchMethod,
        SearchResult,
    } from "./search-types";
    import { clickable } from "../shared/actions/clickable";

    // Type for products coming from cache, which might have category as null and embedding in a raw format
    type ProductFromCache = Omit<Product, "category" | "embedding"> & {
        category: string | null;
        embedding?: unknown; // Will be processed into Float32Array, made optional
    };
    import { parseQuery, deduplicateProducts } from "./search-utils";
    import { SearchApiClient } from "./search-api";
    import {
        SearchStrategyFactory,
        SemanticSearchStrategy,
        HybridDropdownStrategy,
    } from "./search-strategy";
    import { embeddingService } from "./EmbeddingService";
    import {
        isAmbiguousSingleFoodTerm,
        generateExpandedQueriesForAmbiguity,
    } from "./query-utils";


    const dispatch = createEventDispatcher();

    let searchQuery = "";
    let showDropdown = false;
    let searchResultsForDropdown: Array<Product | ProductTypeGroup> = [];
    let initialResultsForDropdown: Array<Product | ProductTypeGroup> = []; // New: store initial text-only results
    let semanticResultsLoading = false; // New: track semantic results status
    let isLoading = false;
    let productIndex: Product[] = [];
    let fuse: Fuse<Product>;
    let apiClient: SearchApiClient;

    // Embedding state
    let embeddingStatus = "Initializing...";
    let queryEmbeddingCache = new Map<string, Float32Array>();
    let lastQueryForEmbedding = "";
    let currentQueryEmbedding: Float32Array | null = null;
    let searchInputRect: DOMRect | null = null;
    let searchInputElement: HTMLElement;
    let currentEmbeddingPromise: Promise<Float32Array | null> | null = null; // Track current embedding calculation

    let latestPreFilteredCandidates: Product[] = [];
    let currentResults: Product[] = [];

    // Constants for search behavior
    const DROPDOWN_RESULTS_LIMIT = 15;
    const PRE_FILTER_LIMIT = 30; // Get more candidates for semantic ranking
    const MINIMUM_QUERY_LENGTH_FOR_EMBEDDING = 4; // Increased from 3 to 4
    const MINIMUM_KEYSTROKE_INTERVAL = 400; // ms to wait before calculating embeddings
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

    const fuseOptions = {
        keys: [
            { name: "name", weight: 2.0 },
            { name: "brand", weight: 1.5 },
            { name: "product_type", weight: 1.0 },
            { name: "category", weight: 0.8 },
            { name: "subcategory", weight: 0.8 },
        ],
        threshold: 0.2,
        includeScore: true,
        useExtendedSearch: true,
        ignoreLocation: true,
    };

    onMount(() => {
        const initialize = async () => {
            try {
                console.log("[SearchBar] Initializing...");
                isLoading = true;

                apiClient = new SearchApiClient(null);

                await initializeEmbeddingService();

                console.log(
                    "[SearchBar] Fetching product index from SearchCacheService...",
                );
                // Skip cache loading since store is removed
                const productsFromCache: any[] = [];
                initializeProductIndex(productsFromCache);

                if (productIndex && productIndex.length > 0) {
                    console.log(
                        "[SearchBar] Eagerly preparing GLOBAL HNSW index for ALL products (after awaiting service init)...",
                    );
                    await embeddingService.prepareHnswIndex(
                        productIndex,
                        false,
                        true,
                    );
                    console.log(
                        "[SearchBar] Global HNSW index preparation request sent/completed.",
                    );
                } else {
                    console.log(
                        "[SearchBar] No products found in cache, skipping global HNSW index preparation.",
                    );
                }
            } catch (e) {
                let message = "Unknown error during initialization";
                if (e instanceof Error) {
                    message = e.message;
                } else if (typeof e === "string") {
                    message = e;
                }
                console.error(
                    "[SearchBar] Error during onMount initialization sequence:",
                    e,
                );
                embeddingStatus = `Error during initialization: ${message}`;
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
        // No need to dispose of embedding service here as it's a singleton
        // It will be reused across component instances
    });

    async function initializeEmbeddingService() {
        try {
            embeddingStatus = "Initializing embedding service...";
            await embeddingService.initialize();
            embeddingStatus = "Embedding service ready";
            console.log("[SearchBar] Embedding service initialized");
        } catch (e) {
            let message = "Unknown error";
            if (e instanceof Error) {
                message = e.message;
            } else if (typeof e === "string") {
                message = e;
            }
            console.error(
                "[SearchBar] Error initializing embedding service:",
                e,
            );
            embeddingStatus = `Error initializing embedding service: ${message}`;
        }
    }

    function initializeProductIndex(products: ProductFromCache[]) {
        if (!products || products.length === 0) {
            console.error(
                "[SearchBar] No products available for search index.",
            );
            productIndex = [];
            return;
        }

        productIndex = products.map((p) => {
            let finalEmbedding: Float32Array | number[] = new Float32Array(0);
            if (
                p.embedding instanceof Float32Array &&
                p.embedding.length === 768
            ) {
                finalEmbedding = p.embedding;
            } else if (
                p.embedding &&
                Array.isArray(p.embedding) &&
                p.embedding.length === 768
            ) {
                try {
                    finalEmbedding = new Float32Array(p.embedding);
                } catch (e) {
                    console.warn(
                        `[SearchBar] Error converting array embedding for product ${p.name || p.productId}`,
                        e,
                    );
                    finalEmbedding = new Float32Array(0);
                }
            } else if (p.embedding) {
                console.warn(
                    `[SearchBar] Product '${p.name || p.productId}' has an unexpected embedding`,
                    p.embedding,
                );
            }

            return {
                name: p.name || "",
                hash: p.hash,
                image_url: p.image_url,
                price: p.price,
                category: p.category === null ? undefined : p.category,
                subcategory: p.subcategory,
                product_type: p.product_type,
                size: p.size,
                brand: p.brand,
                embedding: finalEmbedding,
                ...(p.productId && { productId: p.productId }),
                ...(p.upc && { upc: p.upc }),
                promo_price: p.promo_price,
                stocks_status: p.stocks_status,
                sold_by: p.sold_by,
            };
        });

        console.log(
            `[SearchBar] Product index initialized with ${productIndex.length} products.`,
        );

        initFuse(productIndex.filter((p) => p.name));
    }

    function initFuse(products: Product[]) {
        if (products.length > 0) {
            fuse = new Fuse(products, fuseOptions);
            console.log("[SearchBar] Fuse.js initialized for dropdown.");
        } else {
            console.warn(
                "[SearchBar] No products with names to initialize Fuse.js for dropdown.",
            );
        }
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

            if (preFilteredProducts.length < 3) return;

            const strategy = new HybridDropdownStrategy(
                searchQuery,
                preFilteredProducts,
                currentQueryEmbedding,
                DROPDOWN_RESULTS_LIMIT,
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

        if (!fuse || productIndex.length === 0) {
            console.warn(
                "[SearchBar] Cannot perform search for dropdown - fuse or product index not available",
            );
            return;
        }

        isLoading = true;

        try {
            const { mainTerms, qualifiers } = parseQuery(searchQuery);
            const mainQuery = mainTerms.join(" ");

            const fuseResultsRaw = fuse.search(mainQuery || searchQuery);

            const preFilteredCandidates = fuseResultsRaw
                .slice(0, PRE_FILTER_LIMIT)
                .map((r) => r.item);

            latestPreFilteredCandidates = preFilteredCandidates;

            initialResultsForDropdown = processSearchResultsForDropdown(
                fuseResultsRaw,
                qualifiers,
            );

            searchResultsForDropdown = initialResultsForDropdown;
            showDropdown = searchResultsForDropdown.length > 0;

            if (showDropdown) updateDropdownPosition();

            if (searchQuery.length >= MINIMUM_QUERY_LENGTH_FOR_EMBEDDING) {
                calculateQueryEmbedding();
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
        fuseResults: FuseResult<Product>[],
        qualifiers: string[],
    ): Array<Product | ProductTypeGroup> {
        const searchLower = searchQuery.toLowerCase();
        const searchTerms = searchLower.split(/\s+/);
        fuseResults.sort((a, b) =>
            sortResultsByRelevanceForDropdown(a, b, searchTerms, qualifiers),
        );

        const productTypeMap = new Map<string, ProductTypeGroup>();
        const specificProducts: Product[] = [];

        fuseResults.forEach((result) => {
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
            ...fuseResults
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
        a: FuseResult<Product>,
        b: FuseResult<Product>,
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

        return (a.score ?? 1) - (b.score ?? 1);
    }

    function handleInput() {
        if (currentEmbeddingPromise) {
            calculateQueryEmbedding.cancel();
        }
        debouncedSearchForDropdown();
    }

    function selectProduct(product: Product) {
        showDropdown = false;
        currentResults = []; // Initialize here

        if (fuse) {
            currentResults = fuse.search(searchQuery).map((r) => r.item);
        }

        if (
            !currentResults.some(
                (p) => p.hash.toString() === product.hash.toString(),
            )
        ) {
            currentResults.unshift(product);
        }

        console.log(
            `[SearchBar] Dispatching select with ${currentResults.length} results`,
        );

        dispatch("select", {
            hash: product.hash,
            productName: product.name,
            originalQuery: searchQuery,
            category: product.category,
            subcategory: product.subcategory,
            product_type: product.product_type,
            fuseResults: currentResults,
            searchMethod: "product_selection",
        });
    }

    const executeSemanticSearch = async () => {
        if (!searchQuery.trim()) {
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
                    `[SearchBar PSS] Ambiguous single term detected: "${normalizedSearchQuery}". Generating expanded queries.`,
                );
                const expandedQueries = generateExpandedQueriesForAmbiguity(
                    normalizedSearchQuery,
                );
                console.log(
                    `[SearchBar PSS] Expanded queries for "${normalizedSearchQuery}":`,
                    expandedQueries,
                );
                queryEmbedding =
                    await embeddingService.getAverageEmbedding(expandedQueries);
                if (queryEmbedding) {
                    console.log(
                        `[SearchBar PSS] Successfully generated averaged embedding for "${normalizedSearchQuery}".`,
                    );
                } else {
                    console.warn(
                        `[SearchBar PSS] Failed to generate averaged embedding for "${normalizedSearchQuery}". Falling back to single query embedding.`,
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
                    `[SearchBar PSS] Unable to generate embedding for "${searchQuery}" (final attempt), falling back to text.`,
                );
                console.time(
                    `[SearchBar PSS] Fallback Fuse Search for "${searchQuery}"`,
                );
                const textResults = fuse
                    ? fuse.search(searchQuery).map((r) => r.item)
                    : [];
                console.timeEnd(
                    `[SearchBar PSS] Fallback Fuse Search for "${searchQuery}"`,
                );

                dispatch("viewAll", {
                    query: searchQuery,
                    fuseResults: textResults,
                    isViewAll: true,
                    searchMethod: "text",
                });
                console.timeEnd(`[SearchBar PSS] Total for "${searchQuery}"`);
                isLoading = false;
                return;
            }

            console.time(
                `[SearchBar PSS] Fuse.js Text Search for "${searchQuery}"`,
            );
            const textResults = fuse
                ? fuse.search(searchQuery).map((r) => r.item)
                : [];
            console.timeEnd(
                `[SearchBar PSS] Fuse.js Text Search for "${searchQuery}"`,
            );
            console.log(
                `[SearchBar PSS] Fuse.js found ${textResults.length} text candidates for "${searchQuery}".`,
            );

            console.log(
                `[SearchBar PSS] Creating SemanticSearchStrategy for "${searchQuery}" with ${productIndex.length} total products and ${textResults.length} text candidates.`,
            );
            console.time(
                `[SearchBar PSS] Strategy Creation for "${searchQuery}"`,
            );
            const strategy = SearchStrategyFactory.createStrategy({
                searchMethod: "semantic",
                query: searchQuery,
                queryEmbedding,
                productIndex: productIndex,
                searchResults: textResults,
                apiClient: apiClient,
            });
            console.timeEnd(
                `[SearchBar PSS] Strategy Creation for "${searchQuery}"`,
            );

            console.time(
                `[SearchBar PSS] Strategy Execute for "${searchQuery}"`,
            );
            const result = await strategy.execute();
            console.timeEnd(
                `[SearchBar PSS] Strategy Execute for "${searchQuery}"`,
            );

            dispatch("viewAll", {
                query: searchQuery,
                fuseResults: result.products,
                isViewAll: true,
                searchMethod: "semantic",
            });
        } catch (error) {
            console.error(
                `[SearchBar PSS] Error during semantic search for "${searchQuery}":`,
                error,
            );
            dispatch("viewAll", {
                query: searchQuery,
                fuseResults: [],
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
        console.log(
            "[SearchBar] 'View all results' clicked. Triggering semantic search.",
        );
        performSemanticSearch.cancel();
        performSemanticSearch();
        showDropdown = false;
    }

    function handleTypeSelection(typeItem: ProductTypeGroup) {
        showDropdown = false;
        console.log("[SearchBar] Type selected:", typeItem.type);

        if (fuse && typeItem.type) {
            const textResults = fuse
                .search(typeItem.type)
                .filter((r) => r.item.product_type === typeItem.type)
                .map((r) => r.item);

            const strategy = SearchStrategyFactory.createStrategy({
                searchMethod: "fuse_type_selection",
                query: searchQuery,
                searchResults: textResults,
            });

            strategy.execute().then((result) => {
                dispatch("viewAll", {
                    query: searchQuery,
                    fuseResults: result.products,
                    isViewAll: true,
                    selectedType: typeItem.type,
                    searchMethod: "fuse_type_selection",
                });
            });
        }
    }

    function handleEnterKey() {
        if (searchQuery.trim()) {
            console.log(
                "[SearchBar] Enter key pressed. Triggering semantic search.",
            );
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
            placeholder="Search products..."
            bind:value={searchQuery}
            on:input={handleInput}
            on:click={() => {
                if (searchQuery.trim()) debouncedSearchForDropdown();
            }}
            on:focus={() => {
                if (searchQuery.trim()) debouncedSearchForDropdown();
            }}
            on:keydown={(e) => {
                if (e.key === "Enter" && searchQuery.trim()) {
                    handleEnterKey();
                }
            }}
        />
        {#if isLoading || semanticResultsLoading}
            <div class="search-loading"></div>
        {/if}
    </div>

    {#if showDropdown}
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

    input:hover {
        border-color: var(--primary);
    }

    input:focus {
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
