<script lang="ts">
    // TODO: ProductBrowserData.svelte doing too much
    // maybe centralize resizeObserver logic and simplify data fetching?
    // We have resize observer logic in useVirtualGrid.ts and also useResizeObserver.ts
    import { onDestroy, onMount, createEventDispatcher } from "svelte";
    import { tick } from "svelte";
    import { useResizeObserver } from "../../shared/utils/useResizeObserver";
    import ProductBrowserView from "./ProductBrowserView.svelte";
    import { mainCategories } from "../utils/categoryData";

    // Import NavigationStore for simple navigation
    import { navigationStore } from "../../stores/NavigationStore";
    
    // Import ProductDataService directly
    import { productDataService } from "../services/ProductDataService";

    // Required props - dataManager no longer needed
    export let featuredSubcategories: Array<{
        category: string;
        subcategory: string | null;
    }> = [];

    const dispatch = createEventDispatcher();

    // State variables with proper types
    let categoryProducts: Record<string, any[]> = {};
    let allCategoryProducts: any[] = [];
    let gridContainer: Record<string, any> = {};
    let currentRanges: Record<string, { start: number; end: number }> = {};
    let totalProducts: Record<string, number> = {};
    let containerCapacity: number = 0;
    let rowCapacities: Record<string, number> = {};
    let mainGridContainer: HTMLElement;
    let allProductsTotal: number = 0;
    let hasMore: Record<string, boolean> = {};
    let isLoadingProductType: boolean = false;

    let loadedSubcategoriesSet = new Set<string>();
    let visibleGroups = new Set();

    // Ultra-simple navigation ID to prevent race conditions
    let navigationId = 0;

    // Utility for container capacity calculation
    const calculateContainerCapacity = (container: HTMLElement) =>
        Math.max(1, Math.floor(container.offsetWidth / 245));

    // Utility for consistent product slicing
    const sliceProducts = (products: any[], capacity: number) =>
        products.length > capacity ? products.slice(0, capacity) : products;

    const resizeObserver = useResizeObserver(
        ({ element, identifier }) => {
            if (identifier) {
                handleResize(identifier, element);
            }
        },
        {
            debounceMs: 250,
            attributeName: "data-subcategory",
        },
    );

    export const action = resizeObserver.action;

    // Initialize navigation handling
    onMount(async () => {
        // Wait for DOM to be ready
        await tick();
    });

    // Reactive navigation handling
    $: handleNavigationChange($navigationStore);

    // Handle navigation state changes
    function handleNavigationChange(nav: {
        category: string | null;
        subcategory: string | null;
        productType: string | null;
        searchMode: boolean;
    }) {
        console.log('🧭 Navigation change:', nav);
        
        // Prevent invalid productType without category/subcategory
        if (nav.productType && (!nav.category || !nav.subcategory)) {
            console.warn(
                "Invalid nav state: productType without category/subcategory, resetting...",
            );
            navigationStore.navigate(); // Reset to home
            return;
        }

        if (nav.searchMode) {
            // Search mode - no data loading needed, SearchResults handles its own data
            console.log('🔍 Search mode - no data loading needed');
            return;
        } else if (!nav.category) {
            // Home view
            if (featuredSubcategories.length > 0) {
                console.log('🏠 Loading home view with', featuredSubcategories.length, 'featured subcategories');
                handleNavigation("home");
            }
        } else if (nav.category && nav.subcategory) {
            // Subcategory view
            console.log('📂 Loading subcategory view:', nav.category, '>', nav.subcategory);
            handleNavigation("subcategory");
        } else if (nav.category && !nav.subcategory) {
            // Category view
            console.log('📁 Loading category view:', nav.category);
            handleNavigation("category");
        }
    }

    onDestroy(() => {
        categoryProducts = {};
        allCategoryProducts = [];
        resizeObserver.disconnect();
    });

    // Ultra-simple navigation with race condition protection
    async function handleNavigation(type: "home" | "category" | "subcategory") {
        const currentId = ++navigationId; // Increment and capture navigation ID

        // Pause grid systems during navigation
        resizeObserver.disconnect();

        // Wait for DOM to settle
        await tick();

        switch (type) {
            case "home":
                await loadHomeView(currentId);
                break;
            case "category":
            case "subcategory":
                await loadProductsForCategory(currentId);
                break;
        }

        // Only re-register observers if this navigation is still current
        if (currentId === navigationId) {
            await tick();
            setTimeout(async () => {
                await tick();
                await registerResizeObservers();
            }, 100);
        }
    }

    function handleResize(identifier: string, container: HTMLElement) {
        const newCapacity = calculateContainerCapacity(container);
        const oldCapacity = rowCapacities[identifier] || containerCapacity;

        if (newCapacity !== oldCapacity) {
            updateRowCapacity(identifier, newCapacity, oldCapacity);
        }
    }

    async function updateRowCapacity(
        identifier: string,
        newCapacity: number,
        oldCapacity: number,
    ) {
        rowCapacities[identifier] = newCapacity;
        rowCapacities = { ...rowCapacities };

        if (newCapacity > oldCapacity) {
            const currentEnd = currentRanges[identifier]?.end || 0;
            const currentStart = currentRanges[identifier]?.start || 0;
            const currentlyDisplayed = currentEnd - currentStart;

            if (currentlyDisplayed < newCapacity) {
                await fetchAdditionalProducts(
                    identifier,
                    currentStart,
                    newCapacity,
                );
            }
        } else if (newCapacity < oldCapacity) {
            const currentProducts = categoryProducts[identifier] || [];
            if (currentProducts.length > newCapacity) {
                const newProducts = currentProducts.slice(0, newCapacity);
                categoryProducts[identifier] = newProducts;
                categoryProducts = { ...categoryProducts };

                currentRanges[identifier] = {
                    start: currentRanges[identifier]?.start || 0,
                    end:
                        (currentRanges[identifier]?.start || 0) +
                        newProducts.length,
                };
                currentRanges = { ...currentRanges };
            }
        }
    }

    async function fetchAdditionalProducts(
        identifier: string,
        startIndex: number,
        capacity: number,
    ) {
        if (!productDataService) return;
        
        let category = $navigationStore.category;
        let subcategory = $navigationStore.subcategory;

        if (!$navigationStore.category && identifier.includes("_")) {
            const parts = identifier.split("_");
            category = parts[0];
            subcategory = parts[1];
        } else if (
            !!$navigationStore.category &&
            !$navigationStore.subcategory
        ) {
            subcategory = identifier;
        }

        if (!category || !subcategory) return;

        try {
            const isInSubcategoryView =
                $navigationStore.category && $navigationStore.subcategory;
            // Check if this is a product type row by looking up the subcategory config
            const categoryConfig = mainCategories.find(
                (c) => c.name === category,
            );
            const subcategoryConfig = categoryConfig?.subcategories.find(
                (s) => s.name === subcategory,
            );
            const productTypes =
                subcategoryConfig?.productTypes?.filter((pt) => pt !== "All") ||
                [];
            const isProductTypeRow =
                isInSubcategoryView && productTypes.includes(identifier);

            let result;
            if (isProductTypeRow) {
                result = await productDataService.loadProductTypeProducts(
                    category,
                    subcategory,
                    identifier,
                    true,
                    capacity,
                );
            } else {
                result = await productDataService.loadSubcategoryProducts(
                    category,
                    subcategory,
                    capacity,
                );
            }

            if (result?.products) {
                categoryProducts[identifier] = sliceProducts(
                    result.products,
                    capacity,
                );
                const productsCount = categoryProducts[identifier].length;
                currentRanges[identifier] = {
                    start: startIndex,
                    end: startIndex + productsCount,
                };

                hasMore[identifier] =
                    result.hasMore || result.products.length > capacity;

                // Single reactive trigger
                categoryProducts = categoryProducts;
                currentRanges = currentRanges;
                hasMore = hasMore;
            }
        } catch (error) {
            console.error(
                `Error fetching additional products for ${identifier}:`,
                error,
            );
        }
    }

    async function loadProductsForCategory(navId: number) {
        if (!$navigationStore.category) return;

        resetState();

        if (!mainGridContainer) {
            await tick();
            if (!mainGridContainer) {
                console.error(
                    "Main grid container not available for capacity calculation.",
                );
                return;
            }
        }

        containerCapacity = calculateContainerCapacity(mainGridContainer);

        if ($navigationStore.category && !$navigationStore.subcategory) {
            await loadMainCategoryView(containerCapacity, navId);
        } else if ($navigationStore.category && $navigationStore.subcategory) {
            await loadSubcategoryView(containerCapacity, navId);
        }
    }

    async function loadHomeView(navId: number) {
        if (!productDataService) return;
        
        console.log('🏠 Starting loadHomeView, navId:', navId);
        resetState();

        if (!mainGridContainer) {
            await tick();
            if (!mainGridContainer) {
                console.error(
                    "Main grid container not available for capacity calculation.",
                );
                return;
            }
        }

        containerCapacity = calculateContainerCapacity(mainGridContainer);
        console.log('🏠 Container capacity:', containerCapacity);

        const BATCH_SIZE = 3;

        for (let i = 0; i < featuredSubcategories.length; i += BATCH_SIZE) {
            const currentBatch = featuredSubcategories.slice(i, i + BATCH_SIZE);

            console.log('🏠 Loading batch', i / BATCH_SIZE + 1, 'of', Math.ceil(featuredSubcategories.length / BATCH_SIZE));
            
            const batchResults = await Promise.all(
                currentBatch
                    .map(async (featured) => {
                        if (!productDataService) return null;
                        console.log('📡 Fetching data for:', featured.category, featured.subcategory);
                        const result =
                            await productDataService.loadSubcategoryProducts(
                                featured.category,
                                featured.subcategory || featured.category,
                                containerCapacity,
                            );

                        console.log('📦 Data result for', featured.category, featured.subcategory, ':', result ? `${result.products?.length || 0} products` : 'null');
                        
                        if (result) {
                            return {
                                ...result,
                                identifier: `${featured.category}_${featured.subcategory || featured.category}`,
                                category: featured.category,
                                subcategory:
                                    featured.subcategory || featured.category,
                            };
                        }
                        return null;
                    })
                    .filter(Boolean),
            );

            // Only update if this navigation is still current
            if (navId === navigationId) {
                console.log('🔄 Processing batch results for UI update, batch size:', batchResults.length);
                await processResults(
                    batchResults,
                    containerCapacity,
                    "homeView",
                );
                console.log('✅ UI updated with batch data');
                await tick();
            } else {
                console.log('⏭️ Skipping batch update - navigation changed');
            }
        }
    }

    async function loadProductsForProductType(navId: number) {
        if (!productDataService) return;
        
        if (
            !$navigationStore.category ||
            !$navigationStore.subcategory
        )
            return;

        try {
            if ($navigationStore.productType !== "All") {
                isLoadingProductType = true;

                const result = await productDataService.loadProductTypeProducts(
                    $navigationStore.category,
                    $navigationStore.subcategory,
                    $navigationStore.productType,
                    false,
                );

                // Only update if this navigation is still current
                if (navId === navigationId) {
                    if (result?.products) {
                        allCategoryProducts = result.products;
                        allProductsTotal = result.total;
                    } else {
                        allCategoryProducts = [];
                        allProductsTotal = 0;
                    }
                    isLoadingProductType = false;
                }
            } else {
                await loadProductsForCategory(navId);
            }
        } catch (error) {
            console.error(
                `API Error loading grid for product type ${$navigationStore.productType}:`,
                error,
            );
            // Only update if this navigation is still current
            if (navId === navigationId) {
                allCategoryProducts = [];
                allProductsTotal = 0;
                isLoadingProductType = false;
            }
        }
    }

    async function loadMainCategoryView(capacity: number, navId: number) {
        if (!productDataService) return;
        if (!$navigationStore.category) return;

        const categoryConfig = mainCategories.find(
            (c) => c.name === $navigationStore.category,
        );
        const subcategories = categoryConfig?.subcategories || [];
        const initialSubcategories = subcategories.slice(0, 3);

        const initialResults = await Promise.all(
            initialSubcategories.map(async (sub: any) => {
                if (!productDataService) return null;
                return await productDataService.loadSubcategoryProducts(
                    $navigationStore.category!,
                    sub.name,
                    capacity,
                );
            }),
        );

        // Only update if this navigation is still current
        if (navId === navigationId) {
            await processResults(initialResults, capacity, "subcategory");
            await tick();

            if (subcategories.length > 3) {
                await loadRemainingSubcategories(
                    subcategories.slice(3),
                    capacity,
                    navId,
                );
            }

            await loadAllCategoryProducts(navId);
        }
    }

    async function loadRemainingSubcategories(
        remainingSubcategories: any[],
        capacity: number,
        navId: number,
    ) {
        if (!$navigationStore.category) return;

        const BATCH_SIZE = 5;
        for (let i = 0; i < remainingSubcategories.length; i += BATCH_SIZE) {
            const currentBatch = remainingSubcategories.slice(
                i,
                i + BATCH_SIZE,
            );

            const batchResults = await Promise.all(
                currentBatch.map(async (sub: any) => {
                    if (!productDataService) return null;
                    return await productDataService.loadSubcategoryProducts(
                        $navigationStore.category!,
                        sub.name,
                        capacity,
                    );
                }),
            );

            // Only update if this navigation is still current
            if (navId === navigationId) {
                await processResults(batchResults, capacity, "subcategory");
                await tick();
            }
        }
    }

    async function loadSubcategoryView(capacity: number, navId: number) {
        if (!productDataService) return;
        if (!$navigationStore.category || !$navigationStore.subcategory) return;

        const categoryConfig = mainCategories.find(
            (c) => c.name === $navigationStore.category,
        );
        const subcategoryConfig = categoryConfig?.subcategories.find(
            (s) => s.name === $navigationStore.subcategory,
        );
        if (!subcategoryConfig) {
            console.error(
                `Configuration not found for subcategory: ${$navigationStore.subcategory}`,
            );
            return;
        }

        if (subcategoryConfig?.gridOnly === true) {
            await loadGridOnlySubcategory(navId);
        } else if (
            !$navigationStore.productType ||
            $navigationStore.productType === "All"
        ) {
            await loadProductTypesView(capacity, navId);
        } else {
            await loadProductsForProductType(navId);
        }
    }

    async function loadGridOnlySubcategory(navId: number) {
        if (!productDataService) return;
        if (!$navigationStore.category || !$navigationStore.subcategory) return;

        const result = await productDataService.loadProductTypeProducts(
            $navigationStore.category,
            $navigationStore.subcategory,
            null,
            false,
        );

        // Only update if this navigation is still current
        if (navId === navigationId) {
            if (result?.products) {
                allCategoryProducts = result.products;
                allProductsTotal = result.total;
            } else {
                allCategoryProducts = [];
                allProductsTotal = 0;
            }
        }
    }

    async function loadProductTypesView(capacity: number, navId: number) {
        if (!productDataService) return;
        if (!$navigationStore.category || !$navigationStore.subcategory) return;

        const categoryConfig = mainCategories.find(
            (c) => c.name === $navigationStore.category,
        );
        const subcategoryConfig = categoryConfig?.subcategories.find(
            (s) => s.name === $navigationStore.subcategory,
        );
        const productTypes =
            subcategoryConfig?.productTypes?.filter(
                (pt: string) => pt !== "All",
            ) || [];

        const BATCH_SIZE = 5;
        for (let i = 0; i < productTypes.length; i += BATCH_SIZE) {
            const currentBatch = productTypes.slice(i, i + BATCH_SIZE);

            const batchResults = await Promise.all(
                currentBatch.map(async (type: string) => {
                    if (!productDataService) return null;
                    return await productDataService.loadProductTypeProducts(
                        $navigationStore.category!,
                        $navigationStore.subcategory!,
                        type,
                        true,
                        capacity,
                    );
                }),
            );

            // Only update if this navigation is still current
            if (navId === navigationId) {
                await processResults(batchResults, capacity, "productType");
                await tick();
            }
        }
    }

    async function loadAllCategoryProducts(navId: number) {
        if (!productDataService) return;
        if ($navigationStore.subcategory !== null) {
            return;
        }

        if (!$navigationStore.category) return;

        const gridData = await productDataService.loadAllCategoryProducts(
            $navigationStore.category,
        );

        // Only update if this navigation is still current
        if (navId === navigationId) {
            if (gridData?.products) {
                allCategoryProducts = gridData.products;
                allProductsTotal = gridData.total;
            } else {
                allCategoryProducts = [];
                allProductsTotal = 0;
            }
        }
    }

    async function registerResizeObservers() {
        await tick();
        const productRowNodes = document.querySelectorAll(".product-row-items");

        productRowNodes.forEach((node) => {
            const identifier = node.getAttribute("data-subcategory");
            if (identifier) {
                gridContainer[identifier] = node as HTMLElement;
                resizeObserver.observe(node as HTMLElement);
                loadedSubcategoriesSet.add(identifier);
            }
        });
    }

    // Unified processing function for all result types
    async function processResults(
        results: any[],
        capacity: number,
        type: "subcategory" | "homeView" | "productType",
    ) {
        console.log('🔄 processResults called with', results.length, 'results, type:', type);
        
        for (const result of results) {
            // Extract identifier based on type
            const identifier =
                type === "subcategory"
                    ? result.name
                    : type === "homeView"
                      ? result.identifier
                      : result.type;

            if (!result?.products?.length || !identifier) {
                console.log('⚠️ Skipping result - no products or identifier:', identifier, result?.products?.length);
                continue;
            }

            console.log('🏪 Processing', identifier, 'with', result.products.length, 'products');
            
            const initialProducts = sliceProducts(result.products, capacity);
            currentRanges[identifier] = {
                start: 0,
                end: initialProducts.length,
            };
            categoryProducts[identifier] = initialProducts;
            hasMore[identifier] =
                result.hasMore || result.products.length > capacity;
            rowCapacities[identifier] = capacity;
            visibleGroups.add(identifier);
            
            console.log('✅ Added to UI state:', identifier, 'with', initialProducts.length, 'products');

            // Calculate totals based on type
            if (type === "subcategory") {
                totalProducts[identifier] =
                    result.total || result.products?.length || 0;
            } else if (type === "homeView") {
                try {
                    if (!productDataService) return;
                    const total = await productDataService.calculateTotalForPath(
                        result.category,
                        result.subcategory,
                    );
                    totalProducts[identifier] = total;
                } catch (error) {
                    console.error(
                        `Error getting total for ${identifier}:`,
                        error,
                    );
                    totalProducts[identifier] = result.products?.length || 0;
                }
            } else if (
                type === "productType" &&
                $navigationStore.category &&
                $navigationStore.subcategory
            ) {
                try {
                    if (!productDataService) return;
                    const total = await productDataService.calculateTotalForPath(
                        $navigationStore.category,
                        $navigationStore.subcategory,
                        identifier,
                    );
                    totalProducts[identifier] = total;
                } catch (error) {
                    console.error(
                        `Error getting total for ${identifier}:`,
                        error,
                    );
                    totalProducts[identifier] = result.products?.length || 0;
                }
            }
        }

        // Single reactive trigger
        console.log('🔥 Triggering reactive updates for UI');
        console.log('📊 Final categoryProducts keys:', Object.keys(categoryProducts));
        console.log('📊 Total products per category:', totalProducts);
        
        categoryProducts = categoryProducts;
        currentRanges = currentRanges;
        totalProducts = totalProducts;
        hasMore = hasMore;
        rowCapacities = rowCapacities;
        
        console.log('✅ All reactive updates triggered');
    }

    function resetState() {
        allCategoryProducts = [];
        currentRanges = {};
        categoryProducts = {};
        totalProducts = {};
        hasMore = {};
        rowCapacities = {};
        allProductsTotal = 0;
        isLoadingProductType = false;
        visibleGroups.clear();
        loadedSubcategoriesSet.clear();

        resizeObserver.disconnect();
        gridContainer = {};
    }

    function handleDataLoaded(event: CustomEvent) {
        const {
            newStart,
            products,
            total,
            identifier,
            hasMore: newHasMore,
        } = event.detail;

        if (!identifier) {
            console.error(
                "ProductBrowserData: handleDataLoaded received event without an identifier!",
            );
            return;
        }

        currentRanges[identifier] = {
            start: newStart,
            end: newStart + products.length,
        };

        if (
            totalProducts[identifier] === undefined &&
            typeof total === "number"
        ) {
            totalProducts[identifier] = total;
        }

        hasMore[identifier] = newHasMore;
        categoryProducts[identifier] = products;

        // Single reactive trigger
        currentRanges = currentRanges;
        totalProducts = totalProducts;
        categoryProducts = categoryProducts;
        hasMore = hasMore;
    }

    function handleBoundariesInitialized(event: CustomEvent) {
        const { identifier: id, grandTotal } = event.detail;
        if (id && typeof grandTotal === "number") {
            if (totalProducts[id] !== grandTotal) {
                totalProducts[id] = grandTotal;
                totalProducts = totalProducts;
            }
        }
    }

    function handleReportCategory(event: CustomEvent) {
        dispatch("reportCategory", event.detail);
    }

    function handleProductTypeSelect(event: CustomEvent) {
        const { productType, category, subcategory } = event.detail;
        navigationStore.navigate(category, subcategory, productType);
    }

    function handleViewMore(event: CustomEvent) {
        const { category, subcategory } = event.detail;
        navigationStore.navigate(category, subcategory);
    }

    // mainGridContainer is now passed as a prop to the view component
</script>

<ProductBrowserView
    isHomeView={!$navigationStore.category}
    selectedCategory={$navigationStore.category}
    selectedSubcategory={$navigationStore.subcategory}
    selectedProductType={$navigationStore.productType || "All"}
    {categoryProducts}
    {allCategoryProducts}
    {currentRanges}
    {totalProducts}
    {hasMore}
    {containerCapacity}
    {rowCapacities}
    {action}
    {gridContainer}
    {isLoadingProductType}
    bind:mainGridContainer
    on:dataLoaded={handleDataLoaded}
    on:boundariesInitialized={handleBoundariesInitialized}
    on:reportCategory={handleReportCategory}
    on:productTypeSelect={handleProductTypeSelect}
    on:viewMore={handleViewMore}
/>
