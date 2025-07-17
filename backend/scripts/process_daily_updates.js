// process_daily_updates.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { createRequire } from 'module';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use require for CommonJS modules
const require = createRequire(import.meta.url);

// Configuration
const BATCH_SIZE = 20;
const API_URL = 'http://localhost:3000/api/categorize';
const DELAY_BETWEEN_BATCHES_MS = 3000; // 3 second delay between batches

// Add this helper function for stock status normalization
function normalizeStockStatus(stockStatus) {
    // Handle null, undefined or empty strings
    if (stockStatus === null || stockStatus === undefined || String(stockStatus).trim() === "") {
        return "UNKNOWN";
    }

    // Normalize to uppercase for consistent comparison
    const normalizedStatus = String(stockStatus).toUpperCase();

    // Map all potential values to standard set
    if (normalizedStatus === "HIGH" || normalizedStatus === "IN_STOCK") {
        return "HIGH";
    } else if (normalizedStatus === "LOW" || normalizedStatus === "LIMITED") {
        return "LOW";
    } else {
        return "UNKNOWN"; // Default for any other value
    }
}

function sanitizeStringForJSON(str) {
    if (typeof str !== 'string') {
        return str; // Only process strings
    }
    // Remove control characters (except for common whitespace like \t, \n, \r)
    // \x00-\x08 (null through backspace)
    // \x0B-\x0C (vertical tab, form feed)
    // \x0E-\x1F (shift out through unit separator)
    // \x7F (delete)
    // Replace with an empty string.
    return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function normalizeProductForStorageAndComparison(productData, isFromApiSource = false) {
    const normalized = { ...productData }; // Start with a shallow copy

    // --- Price --- (No change here, it's numeric)
    let rawPrice = normalized.price;
    if (isFromApiSource && normalized.items && normalized.items[0] && typeof normalized.items[0].price?.regular !== 'undefined') {
        rawPrice = normalized.items[0].price.regular;
    } else if (!isFromApiSource && typeof productData.price !== 'undefined') {
        rawPrice = productData.price;
    }
    if (typeof rawPrice === 'string') {
        const parsed = parseFloat(rawPrice);
        rawPrice = isNaN(parsed) ? 0 : parsed;
    }
    normalized.price = (typeof rawPrice === 'number' && !isNaN(rawPrice)) ? parseFloat(rawPrice.toFixed(2)) : 0;

    // --- Promo Price ---
    let rawPromo = normalized.promo_price;
    let regularPrice = normalized.price; // Get the regular price for comparison

    if (isFromApiSource && normalized.items && normalized.items[0]) {
        if (typeof normalized.items[0].price?.promo !== 'undefined') {
            rawPromo = normalized.items[0].price.promo;
        }
        if (typeof normalized.items[0].price?.regular !== 'undefined') {
            regularPrice = normalized.items[0].price.regular;
        }
    } else if (!isFromApiSource) {
        if (typeof productData.promo_price !== 'undefined') {
            rawPromo = productData.promo_price;
        }
        if (typeof productData.price !== 'undefined') {
            regularPrice = productData.price;
        }
    }

    if (typeof rawPromo === 'string') {
        const parsed = parseFloat(rawPromo);
        rawPromo = isNaN(parsed) ? null : parsed;
    }

    // Only set promo_price if it's a valid number, not zero, and less than the regular price
    normalized.promo_price = (typeof rawPromo === 'number' && !isNaN(rawPromo) &&
        rawPromo !== 0 && typeof regularPrice === 'number' &&
        rawPromo < regularPrice) ? parseFloat(rawPromo.toFixed(2)) : null;

    // --- Stocks Status ---
    let rawStock = normalized.stocks_status;
    if (isFromApiSource && normalized.items && normalized.items[0] && typeof normalized.items[0].inventory?.stockLevel !== 'undefined') {
        rawStock = normalized.items[0].inventory.stockLevel;
    } else if (!isFromApiSource && typeof productData.stocks_status !== 'undefined') {
        rawStock = productData.stocks_status;
    }
    normalized.stocks_status = normalizeStockStatus(rawStock);

    // --- Size ---
    let rawSize = normalized.size;
    if (isFromApiSource && normalized.items && normalized.items[0] && typeof normalized.items[0].size !== 'undefined') {
        rawSize = normalized.items[0].size;
    } else if (!isFromApiSource && typeof productData.size !== 'undefined') {
        rawSize = productData.size;
    }
    let sizeString = (rawSize === null || typeof rawSize === 'undefined') ? "" : String(rawSize);
    normalized.size = sanitizeStringForJSON(sizeString); // MODIFIED

    // --- Sold By ---
    let rawSoldBy = normalized.sold_by;
    if (isFromApiSource && normalized.items && normalized.items[0] && typeof normalized.items[0].soldBy !== 'undefined') {
        rawSoldBy = normalized.items[0].soldBy;
    } else if (!isFromApiSource && typeof productData.sold_by !== 'undefined') {
        rawSoldBy = productData.sold_by;
    }
    let soldByString = (rawSoldBy === null || typeof rawSoldBy === 'undefined' || String(rawSoldBy).trim() === "") ? null : String(rawSoldBy);
    normalized.sold_by = soldByString === null ? null : sanitizeStringForJSON(soldByString); // MODIFIED

    // --- Image URL ---
    let rawImageUrl = normalized.image_url;
    if (isFromApiSource && normalized.images && Array.isArray(normalized.images)) {
        const frontImage = normalized.images.find(img => img.perspective === "front");
        if (frontImage && frontImage.sizes && Array.isArray(frontImage.sizes)) {
            const largeSize = frontImage.sizes.find(s => s.size === "large");
            if (largeSize && largeSize.url) { rawImageUrl = largeSize.url; }
        }
    } else if (!isFromApiSource && typeof productData.image_url !== 'undefined') {
        rawImageUrl = productData.image_url;
    }
    let imageUrlString = (rawImageUrl === null || typeof rawImageUrl === 'undefined' || String(rawImageUrl).trim() === "") ? null : String(rawImageUrl);
    normalized.image_url = imageUrlString === null ? null : sanitizeStringForJSON(imageUrlString); // MODIFIED

    // --- Name and Description ---
    const descSource = String(productData.description || productData.name || "");
    const nameSource = String(productData.name || productData.description || "");
    normalized.description = sanitizeStringForJSON(descSource); // MODIFIED
    normalized.name = sanitizeStringForJSON(nameSource); // MODIFIED
    if (!normalized.description && !normalized.name && !normalized.productId) {
        normalized.name = "Unknown Product";
        normalized.description = "Unknown Product";
    }

    // --- Category, Subcategory, Product Type (if they exist on normalized from productData) ---
    if (typeof productData.category === 'string') { // Check productData, not normalized yet for these
        normalized.category = sanitizeStringForJSON(productData.category);
    } else if (productData.category === null) {
        normalized.category = null;
    }

    if (typeof productData.subcategory === 'string') {
        normalized.subcategory = sanitizeStringForJSON(productData.subcategory);
    } else if (productData.subcategory === null) {
        normalized.subcategory = null;
    }

    if (typeof productData.product_type === 'string') {
        normalized.product_type = sanitizeStringForJSON(productData.product_type);
    } else if (productData.product_type === null) {
        normalized.product_type = null;
    }

    // --- Additional Categorizations ---
    if (Array.isArray(productData.additional_categorizations)) { // Check productData
        normalized.additional_categorizations = productData.additional_categorizations.map(addCat => {
            const sanitizedAddCat = { ...addCat };
            if (typeof sanitizedAddCat.main_category === 'string') {
                sanitizedAddCat.main_category = sanitizeStringForJSON(sanitizedAddCat.main_category);
            }
            if (typeof sanitizedAddCat.subcategory === 'string') {
                sanitizedAddCat.subcategory = sanitizeStringForJSON(sanitizedAddCat.subcategory);
            }
            if (typeof sanitizedAddCat.product_type === 'string') {
                sanitizedAddCat.product_type = sanitizeStringForJSON(sanitizedAddCat.product_type);
            }
            return sanitizedAddCat;
        });
    } else {
        normalized.additional_categorizations = [];
    }

    // --- Category Change Flags --- (logic remains same, but sources for original cats need sanitizing)
    if (typeof normalized._categoryChanged !== 'boolean') { normalized._categoryChanged = false; }
    if (normalized._categoryChanged === false) {
        normalized._originalCategory = null; normalized._originalSubcategory = null;
        normalized._originalProductType = null; normalized._originalAdditionalCategorizations = null;
    } else {
        normalized._originalCategory = (typeof productData._originalCategory === 'string') ? sanitizeStringForJSON(productData._originalCategory) : (productData._originalCategory === null ? null : undefined);
        normalized._originalSubcategory = (typeof productData._originalSubcategory === 'string') ? sanitizeStringForJSON(productData._originalSubcategory) : (productData._originalSubcategory === null ? null : undefined);
        normalized._originalProductType = (typeof productData._originalProductType === 'string') ? sanitizeStringForJSON(productData._originalProductType) : (productData._originalProductType === null ? null : undefined);

        if (Array.isArray(productData._originalAdditionalCategorizations)) {
            normalized._originalAdditionalCategorizations = productData._originalAdditionalCategorizations.map(addCat => {
                const sanitizedAddCat = { ...addCat };
                if (typeof sanitizedAddCat.main_category === 'string') {
                    sanitizedAddCat.main_category = sanitizeStringForJSON(sanitizedAddCat.main_category);
                }
                if (typeof sanitizedAddCat.subcategory === 'string') {
                    sanitizedAddCat.subcategory = sanitizeStringForJSON(sanitizedAddCat.subcategory);
                }
                if (typeof sanitizedAddCat.product_type === 'string') {
                    sanitizedAddCat.product_type = sanitizeStringForJSON(sanitizedAddCat.product_type);
                }
                return sanitizedAddCat;
            });
        } else {
            normalized._originalAdditionalCategorizations = null;
        }
    }

    // Clean up fields that are only for source processing if from API
    if (isFromApiSource) {
        delete normalized.items; delete normalized.images;
        if (typeof productData.upc !== 'undefined') { // Check productData for upc
            normalized.upc = (typeof productData.upc === 'string') ? sanitizeStringForJSON(productData.upc) : productData.upc;
        }
    }

    // Ensure essential fields always exist, even if as null or default, and sanitize if string
    if (typeof normalized.productId !== 'string' && typeof normalized.productId !== 'undefined' && normalized.productId !== null) {
        normalized.productId = String(normalized.productId); // Ensure it's a string if not null/undefined
    }
    normalized.productId = (typeof normalized.productId === 'string') ? sanitizeStringForJSON(normalized.productId) : normalized.productId;


    if (typeof normalized.upc !== 'string' && typeof normalized.upc !== 'undefined' && normalized.upc !== null) {
        normalized.upc = String(normalized.upc);
    }
    normalized.upc = (typeof normalized.upc === 'string') ? sanitizeStringForJSON(normalized.upc) : normalized.upc;


    // Category, subcategory, product_type already handled and sanitized or set to null above.
    // Just ensure they default to null if they somehow ended up undefined.
    if (typeof normalized.category === 'undefined') normalized.category = null;
    if (typeof normalized.subcategory === 'undefined') normalized.subcategory = null;
    if (typeof normalized.product_type === 'undefined') normalized.product_type = null;

    // --- Brand ---
    normalized.brand = (typeof productData.brand === 'string') ? sanitizeStringForJSON(productData.brand) : null;

    // --- Is Organic ---
    normalized.is_organic = productData.is_organic === true;

    return normalized;
}

async function processDailyUpdates() {
    try {
        const krogerDataPath = process.argv[2];

        if (!krogerDataPath || !fs.existsSync(krogerDataPath)) {
            console.error('Usage: node process_daily_updates.js <path-to-kroger-data.json>');
            process.exit(1);
        }

        const sortedFilePath = path.join(__dirname, '../../product-categorization/categorized_products_sorted.json');
        const correctionMapPath = path.join(__dirname, '../../product-categorization/correction_map.json');
        const recatQueuePath = path.join(__dirname, '../../product-categorization/products_to_recategorize.json');
        const changeTrackingPath = path.join(__dirname, '../../product-categorization/changed_product_types.json');

        const krogerData = JSON.parse(fs.readFileSync(krogerDataPath, 'utf8'));
        // START OF NEW DEBUGGING BLOCK
        console.log(`[INITIAL_LOAD_DEBUG] Loaded ${krogerData.length} products from ${krogerDataPath}`);
        const targetProductIdForEarlyLog = "0004156500006";
        let foundTargetInKrogerData = false;
        krogerData.forEach((product, index) => {
            if (product.productId === targetProductIdForEarlyLog) {
                console.log(`[INITIAL_LOAD_DEBUG] Found target product ID ${targetProductIdForEarlyLog} at index ${index} in initially loaded krogerData:`);
                try {
                    // Attempt to stringify, but be careful with potentially huge objects
                    // Log key fields first, then try to stringify a limited version
                    console.log(`  productId: ${product.productId}`);
                    console.log(`  description: ${product.description}`);
                    console.log(`  price (from items): ${product.items?.[0]?.price?.regular}`);
                    console.log(`  size (from items): ${product.items?.[0]?.size}`);
                    // console.log(JSON.stringify(product, null, 2)); // Potentially too verbose, uncomment if needed
                } catch (e) {
                    console.log(`  Error stringifying product: ${e.message}`);
                }
                foundTargetInKrogerData = true;
            }
        });
        if (!foundTargetInKrogerData) {
            console.log(`[INITIAL_LOAD_DEBUG] Target product ID ${targetProductIdForEarlyLog} was NOT found in the initially loaded krogerData array.`);
        }
        // END OF NEW DEBUGGING BLOCK
        let sortedProducts = [];
        if (fs.existsSync(sortedFilePath)) {
            sortedProducts = JSON.parse(fs.readFileSync(sortedFilePath, 'utf8'));
        }
        let correctionMap = {};
        if (fs.existsSync(correctionMapPath)) {
            correctionMap = JSON.parse(fs.readFileSync(correctionMapPath, 'utf8'));
        }
        let recatQueue = [];
        if (fs.existsSync(recatQueuePath)) {
            recatQueue = JSON.parse(fs.readFileSync(recatQueuePath, 'utf8'));
        }

        console.log(`Processing ${krogerData.length} products from API against ${sortedProducts.length} existing products`);
        console.log(`Correction map contains ${Object.keys(correctionMap).length} entries`);
        console.log(`Recategorization queue contains ${recatQueue.length} products`);

        const existingProductMap = new Map();
        for (const productInMap of sortedProducts) {
            if (productInMap.productId) {
                existingProductMap.set(productInMap.productId, productInMap);
                if (productInMap.productId.startsWith('0')) {
                    const trimmedId = productInMap.productId.replace(/^0+/, '');
                    existingProductMap.set(trimmedId, productInMap);
                }
            }
            const productNameInMap = productInMap.description || productInMap.name;
            if (productNameInMap) {
                existingProductMap.set(productNameInMap, productInMap);
            }
        }

        console.log('[DEBUG_MAP] existingProductMap populated. Checking entry for 0079913711401:');
        const testProdFromMapById = existingProductMap.get("0079913711401");
        if (testProdFromMapById) {
            console.log(`[DEBUG_MAP] Product 0079913711401 from map (by ID): _catChanged=${testProdFromMapById._categoryChanged}, _origCat=${testProdFromMapById._originalCategory}, Cat=${testProdFromMapById.category}`);
        } else {
            console.log('[DEBUG_MAP] Product 0079913711401 not found by ID in map.');
        }
        const testProdFromMapByName = existingProductMap.get("It's Delish Dill Weed");
        if (testProdFromMapByName) {
            console.log(`[DEBUG_MAP] Product "It's Delish Dill Weed" from map (by Name): _catChanged=${testProdFromMapByName._categoryChanged}, _origCat=${testProdFromMapByName._originalCategory}, Cat=${testProdFromMapByName.category}`);
        } else {
            console.log('[DEBUG_MAP] Product "It\'s Delish Dill Weed" not found by Name in map.');
        }

        const recatProductIds = new Set(recatQueue.map(p => p.productId));
        const newProducts = []; // To store products new to the system from krogerData
        const changedProducts = []; // To store products from krogerData whose description changed
        const unchangedProducts = []; // To store products from krogerData that are existing & largely unchanged

        function findInCorrectionMap(product, correctionMap) {
            if (product.productId && correctionMap[`productId:${product.productId}`]) {
                return correctionMap[`productId:${product.productId}`];
            }
            if (product.description && correctionMap[product.description]) {
                return correctionMap[product.description];
            }
            if (product.description && correctionMap[product.description.toLowerCase()]) {
                return correctionMap[product.description.toLowerCase()];
            }
            if (product.description) {
                const cleanName = product.description.replace(/[®™©]/g, '');
                if (correctionMap[cleanName] || correctionMap[cleanName.toLowerCase()]) {
                    return correctionMap[cleanName] || correctionMap[cleanName.toLowerCase()];
                }
            }
            return null;
        }

        for (const product of krogerData) {
            const productId = product.productId;
            if (!productId) {
                console.warn(`Product without ID: ${product.description || 'Unknown'}`);
                continue;
            }
            if (recatProductIds.has(productId)) {
                console.log(`Product ${productId} (${product.description}) is in recategorization queue, will be processed separately`);
                continue;
            }
            let productFromApiInput = product; // product is from krogerData loop

            // Attempt to find existing product in our master list (which will be normalized by saveResults later)
            // For lookup, we use raw productId and description. Normalization happens if found.
            let existingProductFromFile = null;
            const currentInputProductId = productFromApiInput.productId; // productId from the product in krogerData
            const currentInputProductDescription = productFromApiInput.description;

            if (currentInputProductId) {
                existingProductFromFile = existingProductMap.get(currentInputProductId);
                if (!existingProductFromFile && currentInputProductId.startsWith('0')) {
                    existingProductFromFile = existingProductMap.get(currentInputProductId.replace(/^0+/, ''));
                }
            }

            // If not found by its own ID, AND if we want to consider description matches
            // (be careful with this, as it's the source of the current issue if descriptions are not unique)
            // A better approach if an input product HAS an ID but isn't found by that ID in the map,
            // is to treat it as NEW, rather than trying to match it by a non-unique description
            // to an *existing different product*.

            // Revised logic: If productFromApiInput HAS a productId, we ONLY trust matches on that ID.
            // If productFromApiInput does NOT have a productId (rare), then we can try description.
            if (!currentInputProductId && currentInputProductDescription) {
                // This case is for input products that genuinely lack a productId.
                // The product in categorized_products_sorted.json that matches this description might have an ID.
                const productFromMapByDesc = existingProductMap.get(currentInputProductDescription);
                if (productFromMapByDesc) {
                    // If the one in the map ALSO has no ID, it's a direct match.
                    // If the one in the map HAS an ID, this is a conflict (input has no ID, map has ID for same desc).
                    // For now, let's assume if input has no ID, we use the description match.
                    existingProductFromFile = productFromMapByDesc;
                }
            }
            // If currentInputProductId *exists* but existingProductFromFile is still null (not found by its ID),
            // then this product from the input file should be treated as NEW or potentially a product whose ID changed.
            // It should NOT try to match by description to an existing product that has a DIFFERENT ID.

            // The key change is to avoid the scenario where:
            // input_product_A (ID: 123, Desc: "Same Desc")
            // input_product_B (ID: 456, Desc: "Same Desc")
            // existing_product_C (ID: 789, Desc: "Same Desc")
            // We don't want input_product_A to match existing_product_C via description if ID 123 is not in the map.
            // We want input_product_A to be processed based on its own ID 123.

            // Simpler, more direct logic for the problem at hand:
            // Prioritize lookup by the input product's own ID.
            if (currentInputProductId) {
                existingProductFromFile = existingProductMap.get(currentInputProductId) ||
                    (currentInputProductId.startsWith('0') ? existingProductMap.get(currentInputProductId.replace(/^0+/, '')) : null);
            } else if (currentInputProductDescription) {
                // Only if the input product itself has NO ID, try to find by description.
                existingProductFromFile = existingProductMap.get(currentInputProductDescription);
            }

            // If existingProductFromFile is found, it's from a previous save operation,
            // so we assume it's already in (or will be brought into) canonical form by saveResults.
            // For direct comparison *now*, we should normalize it if we haven't already.
            // However, the main strategy is to normalize API input for comparison,
            // and normalize everything before saving.

            if (existingProductFromFile && (existingProductFromFile.productId === "0079913711401" || (existingProductFromFile.description === "It's Delish Dill Weed" || existingProductFromFile.name === "It's Delish Dill Weed"))) {
                console.log(`[DEBUG_LOOKUP] existingProduct for Dill Weed (before correctionMap block): ID=${existingProductFromFile.productId}, Name=${existingProductFromFile.name || existingProductFromFile.description}, _catChanged=${existingProductFromFile._categoryChanged}, _origCat=${existingProductFromFile._originalCategory}, Cat=${existingProductFromFile.category}`);
            }

            const correctionMapEntry = findInCorrectionMap(productFromApiInput, correctionMap);

            if (correctionMapEntry) {
                const productName = productFromApiInput.description || productFromApiInput.name || "Unknown Product";
                console.log(`[CorrectionMap] Processing: ${productName}`);

                let categoryActuallyChangedThisRun = false;
                let finalOriginalCategory = null;
                let finalOriginalSubcategory = null;
                let finalOriginalProductType = null;
                let determinedOriginalAdditionalCategorizations = null;

                const normalizedCorrectionMapEntry = {
                    category: sanitizeStringForJSON(String(correctionMapEntry.category || "")),
                    subcategory: sanitizeStringForJSON(String(correctionMapEntry.subcategory || "")),
                    product_type: sanitizeStringForJSON(String(correctionMapEntry.product_type || "")),
                };
                if (normalizedCorrectionMapEntry.subcategory === "") normalizedCorrectionMapEntry.subcategory = null;
                if (normalizedCorrectionMapEntry.product_type === "") normalizedCorrectionMapEntry.product_type = null;

                if (existingProductFromFile) {
                    const normalizedExistingFile = normalizeProductForStorageAndComparison(existingProductFromFile, false);
                    const mapDiffersFromFile = normalizedExistingFile.category !== normalizedCorrectionMapEntry.category ||
                        normalizedExistingFile.subcategory !== normalizedCorrectionMapEntry.subcategory ||
                        normalizedExistingFile.product_type !== normalizedCorrectionMapEntry.product_type;

                    if (mapDiffersFromFile) {
                        categoryActuallyChangedThisRun = true;
                        finalOriginalCategory = normalizedExistingFile.category;
                        finalOriginalSubcategory = normalizedExistingFile.subcategory;
                        finalOriginalProductType = normalizedExistingFile.product_type;
                        determinedOriginalAdditionalCategorizations = normalizedExistingFile.additional_categorizations
                            ? JSON.parse(JSON.stringify(normalizedExistingFile.additional_categorizations))
                            : [];
                    } else {
                        if (normalizedExistingFile._categoryChanged === true && normalizedExistingFile._originalCategory) {
                            categoryActuallyChangedThisRun = true;
                            finalOriginalCategory = normalizedExistingFile._originalCategory;
                            finalOriginalSubcategory = normalizedExistingFile._originalSubcategory;
                            finalOriginalProductType = normalizedExistingFile._originalProductType;
                            determinedOriginalAdditionalCategorizations = normalizedExistingFile._originalAdditionalCategorizations;
                            console.log(`[CorrectionMap] Map matches file, but file already has _categoryChanged=true. Preserving existing original details for "${productName}". PID: ${productId}`);
                        } else {
                            console.log(`[CorrectionMap] No category change for "${productName}" (normalized map matches normalized file, no prior _categoryChanged flag). PID: ${productId}`);
                        }
                    }
                } else {
                    categoryActuallyChangedThisRun = true;
                    finalOriginalCategory = null;
                    finalOriginalSubcategory = null;
                    finalOriginalProductType = null;
                    determinedOriginalAdditionalCategorizations = [];
                    console.log(`[CorrectionMap] New product to system "${productName}", using correction map. Flagging _categoryChanged=true. PID: ${productId}`);
                }

                let derivedIsOrganic = false;
                if (productFromApiInput.categories && Array.isArray(productFromApiInput.categories) && productFromApiInput.categories.includes("Natural & Organic")) {
                    derivedIsOrganic = true;
                }

                const correctedProduct = {
                    ...productFromApiInput,
                    category: normalizedCorrectionMapEntry.category,
                    subcategory: normalizedCorrectionMapEntry.subcategory,
                    product_type: normalizedCorrectionMapEntry.product_type,
                    is_organic: derivedIsOrganic,
                    additional_categorizations: (() => {
                        if (existingProductFromFile) {
                            const normalizedExistingFileForAddCat = normalizeProductForStorageAndComparison(existingProductFromFile, false);
                            const mapDoesMatchFileForAddCat = normalizedExistingFileForAddCat.category === normalizedCorrectionMapEntry.category &&
                                normalizedExistingFileForAddCat.subcategory === normalizedCorrectionMapEntry.subcategory &&
                                normalizedExistingFileForAddCat.product_type === normalizedCorrectionMapEntry.product_type;
                            if (mapDoesMatchFileForAddCat && existingProductFromFile.additional_categorizations) {
                                return existingProductFromFile.additional_categorizations;
                            }
                        }
                        return [];
                    })(),
                    _categoryChanged: categoryActuallyChangedThisRun,
                    _originalCategory: finalOriginalCategory,
                    _originalSubcategory: finalOriginalSubcategory,
                    _originalProductType: finalOriginalProductType,
                    _originalAdditionalCategorizations: determinedOriginalAdditionalCategorizations
                };

                if (categoryActuallyChangedThisRun) {
                    console.log(`[CorrectionMapLogic] Adding "${productName}" to changedProducts. _categoryChanged=${correctedProduct._categoryChanged}. PID: ${productId}`);
                    changedProducts.push(correctedProduct);
                } else {
                    const normalizedApiDataForFlags = normalizeProductForStorageAndComparison(productFromApiInput, true);
                    const normalizedExistingProductForFlags = existingProductFromFile ? normalizeProductForStorageAndComparison(existingProductFromFile, false) : null;

                    if (normalizedExistingProductForFlags) {
                        correctedProduct._priceChanged = (normalizedApiDataForFlags.price !== normalizedExistingProductForFlags.price || normalizedApiDataForFlags.promo_price !== normalizedExistingProductForFlags.promo_price);
                        correctedProduct._stocksChanged = (normalizedApiDataForFlags.stocks_status !== normalizedExistingProductForFlags.stocks_status);
                    } else {
                        correctedProduct._priceChanged = false;
                        correctedProduct._stocksChanged = false;
                    }
                    console.log(`[CorrectionMapLogic] Adding "${productName}" to unchangedProducts. PriceChg: ${correctedProduct._priceChanged}, StockChg: ${correctedProduct._stocksChanged}. PID: ${productId}. is_organic will be: ${correctedProduct.is_organic}`);
                    unchangedProducts.push(correctedProduct);
                }
                continue;
            }

            // --- No Correction Map Entry ---
            if (!existingProductFromFile) {
                console.log(`New product (not in correction map): ${productId} - ${productFromApiInput.description}`);
                newProducts.push(productFromApiInput);
            } else {
                const normalizedApiProduct = normalizeProductForStorageAndComparison(productFromApiInput, true);
                const normalizedExistingProductFromFile = normalizeProductForStorageAndComparison(existingProductFromFile, false);

                // === START DEBUGGING hasSignificantChanges ===
                const significantChangeResult = hasSignificantChanges(normalizedApiProduct, normalizedExistingProductFromFile);

                if (significantChangeResult) {


                    console.log(`Changed product (significant desc change, not in correction map): ${productId} - ${normalizedApiProduct.description}`);
                    changedProducts.push(productFromApiInput);
                } else {
                    // === END DEBUGGING hasSignificantChanges ===
                    // The following console.log was slightly modified to ensure normalizedApiProduct.description is used,
                    // as productFromApiInput.description might not be normalized yet at this point of logging.
                    console.log(`Unchanged product (description same, not in correction map): ${productId} - "${normalizedApiProduct.description}"`);

                    const priceChanged = (normalizedApiProduct.price !== normalizedExistingProductFromFile.price || normalizedApiProduct.promo_price !== normalizedExistingProductFromFile.promo_price);
                    const stocksChanged = (normalizedApiProduct.stocks_status !== normalizedExistingProductFromFile.stocks_status);

                    const unchangedProductData = {
                        ...normalizedExistingProductFromFile, // Base with existing normalized categorized data
                        items: productFromApiInput.items,     // Take latest price/stock source
                        images: productFromApiInput.images,   // Take latest image source
                        description: productFromApiInput.description, // Take latest desc casing from API input
                        name: productFromApiInput.description,        // Keep name consistent with description
                        _priceChanged: priceChanged,
                        _stocksChanged: stocksChanged
                        // _categoryChanged and its original companions are already preserved by `...normalizedExistingProductFromFile`
                    };
                    unchangedProducts.push(unchangedProductData);
                }
            }
        }

        console.log(`\nSummary:`);
        console.log(`- New products: ${newProducts.length}`); // Will go to API Categorizer
        console.log(`- Changed products: ${changedProducts.length}`); // Will go to API Categorizer
        console.log(`- Unchanged products: ${unchangedProducts.length}`); // Already categorized, price/stock updated
        console.log(`- Products in recategorization queue: ${recatProductIds.size}`);

        const productsToProcessViaApi = [...newProducts, ...changedProducts];
        let resultsFromCategorizer = [];

        if (productsToProcessViaApi.length > 0) {
            resultsFromCategorizer = await processBatches(productsToProcessViaApi);
        } else {
            console.log('No products need categorization through API for this run.');
        }

        // `resultsFromCategorizer` now contains products that went through the full API categorization (LLM + dual/multi).
        // `unchangedProducts` contains products that were matched from krogerData to existing ones and didn't need full re-cat,
        // but their price/stock/etc. are updated from the latest krogerData fetch.

        // `resultsFromCategorizer` now contains products that went through the full API categorization (LLM + dual/multi).
        // `unchangedProducts` contains products that were matched from krogerData to existing ones and didn't need full re-cat,
        // but their price/stock/etc. are updated from the latest krogerData fetch.

        // Create a set of product IDs that were genuinely new in this run's `newProducts` list
        const newProductIdsFromThisRun = new Set(newProducts.map(p => p.productId)); // This is your original correct line

        // `productsActuallyProcessedInThisRun` are those from `krogerData` that were either newly categorized or updated.
        // This list contains products with their _priceChanged and _stocksChanged flags correctly set from the comparison.
        const productsActuallyProcessedInThisRun = [...resultsFromCategorizer, ...unchangedProducts];

        const isFirstRun = sortedProducts.length === 0; // Based on file state before this run

        // Call trackChangedProductTypes WITH the list that has the flags still set
        // (productsActuallyProcessedInThisRun)
        const changedProductTypes = trackChangedProductTypes(productsActuallyProcessedInThisRun, isFirstRun, newProductIdsFromThisRun);

        fs.writeFileSync(changeTrackingPath, JSON.stringify(changedProductTypes, null, 2));
        if (changedProductTypes.length > 0) {
            console.log(`Saved ${changedProductTypes.length} changed product types to tracking file`);
        } else {
            console.log('Created empty change tracking file - no products changed in ways requiring DHT path updates.');
        }

        // Now, call saveResults, which will normalize and then reset the _priceChanged/_stocksChanged flags before saving.
        // The finalCompleteProductList is what gets written to the file.
        const finalCompleteProductList = await saveResults(productsActuallyProcessedInThisRun, sortedFilePath, existingProductMap, krogerData);

        console.log(`\nProcessing complete!`);
        console.log(`- Total products in updated files: ${finalCompleteProductList.length}`);
        if (changedProductTypes.length > 0) {
            console.log(`- Paths ready for DHT sync are listed in changed_product_types.json`);
        } else {
            console.log(`- No paths flagged for DHT sync in this cycle (no relevant changes detected).`);
        }
        console.log(`- Product types changed (paths for DHT sync): ${changedProductTypes.length}`);
        console.log(`- Total products in updated files: ${finalCompleteProductList.length}`);
        if (changedProductTypes.length > 0) {
            console.log(`- Paths ready for DHT sync are listed in changed_product_types.json`);
        } else {
            console.log(`- No paths flagged for DHT sync in this cycle (no relevant changes detected).`);
        }
        console.log(`- Product types changed (paths for DHT sync): ${changedProductTypes.length}`);


    } catch (error) { // THIS IS THE CATCH FOR THE MAIN TRY BLOCK
        console.error('Error processing daily updates:', error);
        process.exit(1);
    }
}

function trackChangedProductTypes(allFinalProducts, isFirstRun = false, newProductIdsFromCurrentRun = new Set()) {
    const changedTypes = new Set();

    console.log(`[DEBUG_TRACK] trackChangedProductTypes CALLED. Received allFinalProducts list length: ${allFinalProducts.length}, isFirstRun: ${isFirstRun}, New products in this run: ${newProductIdsFromCurrentRun.size}`);

    const addPathsToSet = (productData, context_msg = "") => {
        let pName, primaryCat, primarySub, primaryType, currentAdditionalCategorizations;

        if (productData.product && typeof productData.main_category !== 'undefined') {
            // This structure comes from resultsFromCategorizer (API response wrapper)
            pName = (productData.product.description || productData.product.name) || `Unknown Product (${context_msg} - from API wrapper)`;
            primaryCat = productData.main_category;
            primarySub = productData.subcategory;
            primaryType = productData.product_type;
            currentAdditionalCategorizations = productData.additional_categorizations || [];
        } else {
            // This structure is for direct product objects (e.g., from unchangedProducts or old file format)
            pName = productData.description || productData.name || `Unknown Product (${context_msg} - direct object)`;
            primaryCat = productData.category;
            primarySub = productData.subcategory;
            primaryType = productData.product_type;
            currentAdditionalCategorizations = productData.additional_categorizations || [];
        }

        if (primaryCat) {
            const primaryKey = JSON.stringify({
                category: primaryCat,
                subcategory: primarySub || null,
                product_type: primaryType || null
            });
            console.log(`[DEBUG_TRACK ${context_msg}] Adding primary path for ${pName}: ${primaryKey}`);
            changedTypes.add(primaryKey);
        } else {
            console.warn(`[DEBUG_TRACK ${context_msg}] Skipping primary path for ${pName} (ID: ${productData.productId || 'N/A'}) due to missing primary category.`);
        }

        if (currentAdditionalCategorizations && currentAdditionalCategorizations.length > 0) {
            for (const addCat of currentAdditionalCategorizations) {
                if (addCat.main_category) {
                    const additionalKey = JSON.stringify({
                        category: addCat.main_category,
                        subcategory: addCat.subcategory || null,
                        product_type: addCat.product_type || null
                    });
                    console.log(`[DEBUG_TRACK ${context_msg}] Adding additional path for ${pName}: ${additionalKey}`);
                    changedTypes.add(additionalKey);
                } else {
                    console.warn(`[DEBUG_TRACK ${context_msg}] Skipping additional_categorization for ${pName} due to missing main_category in addCat:`, addCat);
                }
            }
        }
    }; // End addPathsToSet

    if (isFirstRun) {
        console.log("[DEBUG_TRACK] First run detected - marking ALL product types from allFinalProducts for DHT update");
        for (const product of allFinalProducts) {
            addPathsToSet(product, "FirstRun");
        }
    } else {
        console.log(`[DEBUG_TRACK] Not first run. Examining ${allFinalProducts.length} products from final list for changes.`);
        for (const product of allFinalProducts) {
            const productName = product.description || product.name || "unknown product from final list";
            let pathsAddedForThisProduct = false;

            console.log(`[DEBUG_TRACK] Checking product from final list: ${productName}, _catChanged=${product._categoryChanged}, _origCat=${product._originalCategory}, _priceChanged=${product._priceChanged}, _stocksChanged=${product._stocksChanged}, isNewThisRun=${newProductIdsFromCurrentRun.has(product.productId)}`);

            if (product._categoryChanged === true && product._originalCategory) {
                console.log(`[DEBUG_TRACK] Product has _categoryChanged=true: ${productName}. Old primary: ${product._originalCategory}`);
                addPathsToSet(product, "CatChanged-NewPaths");

                const oldPrimaryPathKey = JSON.stringify({
                    category: product._originalCategory,
                    subcategory: product._originalSubcategory || null,
                    product_type: product._originalProductType || null
                });
                console.log(`[DEBUG_TRACK] Adding OLD primary path for ${productName}: ${oldPrimaryPathKey}`);
                changedTypes.add(oldPrimaryPathKey);

                if (product._originalAdditionalCategorizations && product._originalAdditionalCategorizations.length > 0) {
                    for (const oldAddCat of product._originalAdditionalCategorizations) {
                        if (oldAddCat.main_category) {
                            const oldAddKey = JSON.stringify({
                                category: oldAddCat.main_category,
                                subcategory: oldAddCat.subcategory || null,
                                product_type: oldAddCat.product_type || null
                            });
                            console.log(`[DEBUG_TRACK] Adding OLD additional path for ${productName}: ${oldAddKey}`);
                            changedTypes.add(oldAddKey);
                        }
                    }
                }
                pathsAddedForThisProduct = true;
            }

            else if (product.productId && newProductIdsFromCurrentRun.has(product.productId)) {
                console.log(`[DEBUG_TRACK] Product is new in this run (from newProductIdsFromCurrentRun): ${productName}`);
                addPathsToSet(product, "NewProduct-CurrentPaths");
                pathsAddedForThisProduct = true;
            }

            if (product._priceChanged || product._stocksChanged) {
                console.log(`[DEBUG_TRACK] Product has _priceChanged or _stocksChanged: ${productName}`);
                if (!pathsAddedForThisProduct) {
                    addPathsToSet(product, "PriceStockChanged-CurrentPaths");
                }
            }
        }
    }

    const finalChangedTypes = Array.from(changedTypes).map(key => JSON.parse(key));
    console.log(`[DEBUG_TRACK] trackChangedProductTypes: Returning ${finalChangedTypes.length} unique changed types.`);
    return finalChangedTypes;
}

// In backend/scripts/process_daily_updates.js

function hasSignificantChanges(normalizedApiProduct, normalizedExistingProductFromFile) {
    // Remove special characters like ®, ™, © before comparison
    const apiDescCleaned = normalizedApiProduct.description.toLowerCase().replace(/[®™©]/g, '');
    const existingDescCleaned = normalizedExistingProductFromFile.description.toLowerCase().replace(/[®™©]/g, '');

    if (apiDescCleaned !== existingDescCleaned) {
        console.log(`[hasSignificantChanges] Significant description change detected (comparing normalized, then lowercased): API="${normalizedApiProduct.description}" vs FILE="${normalizedExistingProductFromFile.description}" - will re-evaluate categorization.`);
        return true;
    }
    // If descriptions are same (ignoring case and special characters), no significant change for categorization purposes.
    return false;
}

async function processBatches(products) {
    const allResults = [];
    let taxonomyCacheName = null;
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = products.slice(i, Math.min(i + BATCH_SIZE, products.length));
        console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(products.length / BATCH_SIZE)}`);
        console.log(`Products ${i + 1} to ${Math.min(i + BATCH_SIZE, products.length)} of ${products.length}`);
        try {
            const requestBody = { products: batch };
            if (taxonomyCacheName) {
                requestBody.taxonomy_cache_name_from_client = taxonomyCacheName;
                console.log(`Using taxonomy cache: ${taxonomyCacheName}`);
            }
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                timeout: 180000
            });
            if (!response.ok) {
                throw new Error(`API returned status ${response.status}: ${await response.text()}`);
            }
            const data = await response.json();
            console.log("Raw API response:", JSON.stringify(data).substring(0, 200) + "...");
            if (data.taxonomy_cache_name) {
                taxonomyCacheName = data.taxonomy_cache_name;
                console.log(`Updated taxonomy cache name: ${taxonomyCacheName}`);
            }
            const originalProductMap = new Map();
            for (const product of batch) {
                if (product.productId) {
                    originalProductMap.set(product.productId, product);
                }
                if (product.description || product.name) {
                    originalProductMap.set(product.description || product.name, product);
                }
            }
            let batchResults = [];
            if (data.categorizedProducts && Array.isArray(data.categorizedProducts)) {
                batchResults = data.categorizedProducts;
                console.log(`Processing ${batchResults.length} products from categorizedProducts array`);
            } else if (Array.isArray(data)) {
                batchResults = data;
                console.log(`Processing ${batchResults.length} products from direct array response`);
            } else {
                console.error("Unexpected API response format:", Object.keys(data));
                continue;
            }
            for (const result of batchResults) { // result is from API /api/categorize: { product: {}, main_category, ... }
                const apiResultProductId = result.product?.productId || result.productId;
                const apiResultProductName = result.product?.name || result.name; // Name from result.product if available

                let originalProductFromBatch = null;
                if (apiResultProductId) {
                    originalProductFromBatch = originalProductMap.get(apiResultProductId);
                }
                if (!originalProductFromBatch && apiResultProductName) { // Fallback to name if ID didn't match
                    originalProductFromBatch = originalProductMap.get(apiResultProductName);
                }

                if (originalProductFromBatch) {
                    // Carry over any pre-existing flags from the product that was sent TO the API
                    // These flags would have been set in the main loop (e.g., if it was a correctionMap item that changed category)
                    if (originalProductFromBatch._categoryChanged !== undefined) {
                        result._categoryChanged = originalProductFromBatch._categoryChanged;
                        result._originalCategory = originalProductFromBatch._originalCategory;
                        result._originalSubcategory = originalProductFromBatch._originalSubcategory;
                        result._originalProductType = originalProductFromBatch._originalProductType;
                        result._originalAdditionalCategorizations = originalProductFromBatch._originalAdditionalCategorizations;
                        console.log(`Preserving _categoryChanged flags for ${apiResultProductName || apiResultProductId} through processBatches`);
                    }
                    // Also carry over price/stock change flags if they were on the input to the batch
                    // (This is less common as products going to API categorizer usually don't have these pre-set,
                    // but good for completeness if a "changedProduct" already had them determined)
                    if (originalProductFromBatch._priceChanged !== undefined) {
                        result._priceChanged = originalProductFromBatch._priceChanged;
                    }
                    if (originalProductFromBatch._stocksChanged !== undefined) {
                        result._stocksChanged = originalProductFromBatch._stocksChanged;
                    }
                }
            }
            allResults.push(...batchResults);
            console.log(`Successfully processed batch of ${batch.length} products, preserved metadata flags`);
            if (i + BATCH_SIZE < products.length) {
                console.log(`Waiting ${DELAY_BETWEEN_BATCHES_MS / 1000} seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
            }
        } catch (error) {
            console.error(`Error processing batch: ${error.message}`);
            console.error(`Failed at index ${i}. Continuing with next batch...`);
        }
    }
    return allResults;
}

async function saveResults(processedProducts, sortedFilePath, existingProductMap, krogerDataFromInputFile) {
    const finalProductsById = new Map();
    const finalProductsByDescNoId = new Map();

    console.log("[saveResults] Normalizing and merging processed products:", processedProducts.length);

    for (const productFromCurrentRun of processedProducts) {
        let baseDataForNormalization;
        if (productFromCurrentRun.product && productFromCurrentRun.main_category !== undefined) {
            baseDataForNormalization = {
                ...(productFromCurrentRun.product),
                category: productFromCurrentRun.main_category,
                subcategory: productFromCurrentRun.subcategory,
                product_type: productFromCurrentRun.product_type,
                additional_categorizations: productFromCurrentRun.additional_categorizations || [],
                _categoryChanged: productFromCurrentRun._categoryChanged,
                _originalCategory: productFromCurrentRun._originalCategory,
                _originalSubcategory: productFromCurrentRun._originalSubcategory,
                _originalProductType: productFromCurrentRun._originalProductType,
                _originalAdditionalCategorizations: productFromCurrentRun._originalAdditionalCategorizations,
                _priceChanged: productFromCurrentRun._priceChanged,
                _stocksChanged: productFromCurrentRun._stocksChanged,
            };
            const productIdToFind = baseDataForNormalization.productId;
            if (productIdToFind) {
                const originalApiProduct = krogerDataFromInputFile.find(p => p.productId === productIdToFind);
                if (originalApiProduct) {
                    if (!baseDataForNormalization.items && originalApiProduct.items) baseDataForNormalization.items = originalApiProduct.items;
                    if (!baseDataForNormalization.images && originalApiProduct.images) baseDataForNormalization.images = originalApiProduct.images;
                    if (!baseDataForNormalization.upc && originalApiProduct.upc) baseDataForNormalization.upc = originalApiProduct.upc;
                    if (!baseDataForNormalization.description && originalApiProduct.description) baseDataForNormalization.description = originalApiProduct.description;
                    if (!baseDataForNormalization.name && originalApiProduct.description) baseDataForNormalization.name = originalApiProduct.description;
                }
            }
        } else {
            baseDataForNormalization = { ...productFromCurrentRun };
        }

        console.log("Stringifying baseDataForNormalization (0086823500048) - logging keys and sanitized strings for safety:");
        for (const key in baseDataForNormalization) {
            if (Object.prototype.hasOwnProperty.call(baseDataForNormalization, key)) {
                const value = baseDataForNormalization[key];
                if (typeof value === 'string') {
                    console.log(`  "${key}": "${sanitizeStringForJSON(value.substring(0, 100))}${value.length > 100 ? '...' : ''}" (Length: ${value.length})`);
                } else if (typeof value === 'object' && value !== null) {
                    console.log(`  "${key}": [Object - Keys: ${Object.keys(value).join(', ')}]`);
                } else {
                    console.log(`  "${key}": ${value}`);
                }
            }
        }

        const needsApiSourceNormalization = !!(baseDataForNormalization.items || baseDataForNormalization.images);
        let normalizedProduct = normalizeProductForStorageAndComparison(baseDataForNormalization, needsApiSourceNormalization); // Make normalizedProduct mutable

        console.log("Stringifying normalizedProduct (0086823500048) - logging keys and sanitized strings for safety:");
        // ... (existing logging for normalizedProduct - ensure it logs BEFORE flag reset) ...
        // Example:
        for (const key in normalizedProduct) {
            if (Object.prototype.hasOwnProperty.call(normalizedProduct, key)) {
                const value = normalizedProduct[key];
                if (typeof value === 'string') {
                    console.log(`  (Before Flag Reset) "${key}": "${sanitizeStringForJSON(value.substring(0, 100))}${value.length > 100 ? '...' : ''}" (Length: ${value.length})`);
                } else if (typeof value === 'object' && value !== null) {
                    console.log(`  (Before Flag Reset) "${key}": [Object - Keys: ${Object.keys(value).join(', ')}]`);
                } else {
                    console.log(`  (Before Flag Reset) "${key}": ${value}`);
                }
            }
        }


        // +++ START OF FLAG RESET LOGIC FOR SAVE +++
        // Reset _priceChanged and _stocksChanged before saving,
        // as their purpose is for the current run's trackChangedProductTypes.
        // Do NOT reset _categoryChanged here; that has a different lifecycle.
        if (normalizedProduct.hasOwnProperty('_priceChanged')) {
            normalizedProduct._priceChanged = false;
        }
        if (normalizedProduct.hasOwnProperty('_stocksChanged')) {
            normalizedProduct._stocksChanged = false;
        }
        // +++ END OF FLAG RESET LOGIC FOR SAVE +++


        const currentProductId = normalizedProduct.productId;
        const currentDescription = normalizedProduct.description;
        if (currentProductId) {
            finalProductsById.set(currentProductId, normalizedProduct); // Save the version with reset flags
        } else if (currentDescription) {
            finalProductsByDescNoId.set(currentDescription, normalizedProduct); // Save the version with reset flags
        } else {
            console.warn('[saveResults] Product from current run has no ID and no description after normalization. Skipping:', normalizedProduct);
        }
    }
    console.log(`[saveResults] Phase 1 complete. Processed ${finalProductsById.size} products with IDs from current run, ${finalProductsByDescNoId.size} with only description.`);

    console.log("[saveResults] Phase 2: Processing existing products not in current run...");
    for (const productFromMap of existingProductMap.values()) {
        const mapProductId = productFromMap.productId;
        const mapDescription = productFromMap.description || productFromMap.name;
        let alreadyProcessed = false;
        if (mapProductId) {
            if (finalProductsById.has(mapProductId)) { alreadyProcessed = true; }
        } else if (mapDescription) {
            if (finalProductsByDescNoId.has(mapDescription)) { alreadyProcessed = true; }
        }
        if (!alreadyProcessed) {
            // For products carried over, we still want to ensure they conform to the final structure
            // (i.e., image_url is present, items/images arrays are not).
            // Determine if `isFromApiSource` should effectively be true for normalization
            // if the productFromMap (from the old file) still has these arrays.
            const hasVestigialApiArrays = !!(productFromMap.items || productFromMap.images);
            let normalizedProduct = normalizeProductForStorageAndComparison(productFromMap, hasVestigialApiArrays); // Make mutable

            // Explicitly delete items and images arrays if they somehow survived normalization,
            // or if hasVestigialApiArrays was false but they were still present on productFromMap.
            // This ensures the final saved structure is clean for carried-over products.
            if (normalizedProduct.hasOwnProperty('items')) {
                delete normalizedProduct.items;
            }
            if (normalizedProduct.hasOwnProperty('images')) {
                delete normalizedProduct.images;
            }

            // Ensure image_url is present if it can be derived from a lingering 'images' array on productFromMap.
            // This handles cases where a product was saved with 'images' but without 'image_url' properly set.
            if (!normalizedProduct.image_url && productFromMap.images && Array.isArray(productFromMap.images)) {
                const frontImage = productFromMap.images.find(img => img.perspective === "front");
                if (frontImage && frontImage.sizes && Array.isArray(frontImage.sizes)) {
                    const largeSize = frontImage.sizes.find(s => s.size === "large");
                    if (largeSize && largeSize.url) {
                        normalizedProduct.image_url = sanitizeStringForJSON(String(largeSize.url));
                    }
                }
            }
            // Ensure image_url is null, not undefined, if no URL was found.
            if (normalizedProduct.image_url === undefined) {
                normalizedProduct.image_url = null;
            }


            // +++ START OF FLAG RESET LOGIC FOR SAVE (Phase 2 products) +++
            // These products were not in the current API fetch, so their price/stock didn't change *this run*.
            // Their flags should already be false if loaded from a properly saved file where flags were reset,
            // but this ensures consistency.
            if (normalizedProduct.hasOwnProperty('_priceChanged')) {
                normalizedProduct._priceChanged = false;
            }
            if (normalizedProduct.hasOwnProperty('_stocksChanged')) {
                normalizedProduct._stocksChanged = false;
            }
            // Do NOT touch _categoryChanged
            // +++ END OF FLAG RESET LOGIC FOR SAVE (Phase 2 products) +++

            if (normalizedProduct.productId) {
                finalProductsById.set(normalizedProduct.productId, normalizedProduct); // Save with cleaned structure and reset flags
            } else if (normalizedProduct.description) {
                finalProductsByDescNoId.set(normalizedProduct.description, normalizedProduct); // Save with cleaned structure and reset flags
            } else {
                console.warn('[saveResults] Product from map (not in current run) has no ID/desc after normalization. Skipping:', normalizedProduct);
            }
        }
    }
    console.log(`[saveResults] Phase 2 complete. Total unique products with IDs: ${finalProductsById.size}, with only description: ${finalProductsByDescNoId.size}.`);

    const finalProductList = Array.from(finalProductsById.values()).concat(Array.from(finalProductsByDescNoId.values()));
    finalProductList.sort((a, b) => {
        const catA = a.category || ""; const catB = b.category || "";
        if (catA !== catB) return catA.localeCompare(catB);
        const subA = a.subcategory || ""; const subB = b.subcategory || "";
        if (subA !== subB) return subA.localeCompare(subB);
        const typeA = a.product_type || ""; const typeB = b.product_type || "";
        if (typeA !== typeB) return typeA.localeCompare(typeB);
        const nameA = a.description || ""; const nameB = b.description || "";
        return nameA.localeCompare(nameB);
    });

    // --- MODIFIED WRITING LOGIC ---
    console.log(`[saveResults] Attempting to write ${finalProductList.length} products to file incrementally.`);
    try {
        fs.writeFileSync(sortedFilePath, '[\n'); // Start with opening bracket
        finalProductList.forEach((product, index) => {
            let productString;
            try {
                productString = JSON.stringify(product, null, 2);
            } catch (stringifyError) {
                console.error(`[SAVE_RESULTS_ERROR] Could not stringify product at index ${index} (ID: ${product.productId}, Name: ${product.name}):`, stringifyError);
                console.error("[SAVE_RESULTS_ERROR] Problematic product object:", product); // Log the object that failed
                // Skip this product or throw an error to stop the whole process
                // For now, let's skip it and continue, but this means data loss.
                return; // Skips this iteration of forEach
            }

            // Indent each line of the product string for pretty printing within the array
            const indentedProductString = productString.split('\n').map(line => '  ' + line).join('\n');
            fs.appendFileSync(sortedFilePath, indentedProductString);
            if (index < finalProductList.length - 1) {
                fs.appendFileSync(sortedFilePath, ',\n'); // Add comma and newline if not the last item
            } else {
                fs.appendFileSync(sortedFilePath, '\n'); // Just a newline for the last item
            }
        });
        fs.appendFileSync(sortedFilePath, ']\n'); // End with closing bracket
        console.log(`[saveResults] Successfully wrote ${finalProductList.length} products to ${sortedFilePath}`);

        // Also write to the unsorted path using the same incremental method
        const unsortedPath = sortedFilePath.replace('_sorted.json', '.json');
        if (fs.existsSync(unsortedPath) || sortedFilePath.includes("_sorted")) {
            fs.writeFileSync(unsortedPath, '[\n'); // Start with opening bracket
            finalProductList.forEach((product, index) => { // Using finalProductList which is sorted, but for unsorted file name
                let productString;
                try {
                    productString = JSON.stringify(product, null, 2);
                } catch (stringifyErrorInner) {
                    console.error(`[SAVE_RESULTS_ERROR] Could not stringify product for unsorted file at index ${index} (ID: ${product.productId}, Name: ${product.name}):`, stringifyErrorInner);
                    return;
                }
                const indentedProductString = productString.split('\n').map(line => '  ' + line).join('\n');
                fs.appendFileSync(unsortedPath, indentedProductString);
                if (index < finalProductList.length - 1) {
                    fs.appendFileSync(unsortedPath, ',\n');
                } else {
                    fs.appendFileSync(unsortedPath, '\n');
                }
            });
            fs.appendFileSync(unsortedPath, ']\n');
            console.log(`[saveResults] Successfully wrote ${finalProductList.length} products to ${unsortedPath}`);
        }
    } catch (error) {
        console.error(`[SAVE_RESULTS_ERROR] Error during incremental file write:`, error);
        // If an error occurs here, the JSON file will likely be incomplete/corrupt.
        // Consider deleting the partially written file or handling this more gracefully.
        throw error; // Re-throw to let the main try/catch handle it
    }
    // --- END OF MODIFIED WRITING LOGIC ---

    return finalProductList;
}

processDailyUpdates().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});