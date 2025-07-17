const fs = require('fs');
const path = require('path');

const categorizedProductsPath = path.join(__dirname, 'categorized_products_sorted.json');
const correctionMapPath = path.join(__dirname, 'correction_map.json');
const reportLogPath = path.join(__dirname, 'correction_map_generation_report.log'); // Log file for details

// Clear previous report log
if (fs.existsSync(reportLogPath)) {
    fs.unlinkSync(reportLogPath);
}

const logReport = (message) => {
    fs.appendFileSync(reportLogPath, message + '\n');
    console.log(message); // Also log to console for immediate feedback
};

logReport(`--- Correction Map Generation Report (${new Date().toISOString()}) ---`);
logReport(`Reading categorized products from: ${categorizedProductsPath}`);
logReport(`Will write correction map to: ${correctionMapPath}`);

try {
    const categorizedProductsFileContent = fs.readFileSync(categorizedProductsPath, 'utf8');
    const products = JSON.parse(categorizedProductsFileContent);

    if (!Array.isArray(products)) {
        logReport('ERROR: categorized_products_sorted.json does not contain a JSON array.');
        process.exit(1);
    }

    logReport(`Successfully read ${products.length} products from ${categorizedProductsPath}`);

    const newCorrectionMap = {};
    const nowTimestamp = new Date().toISOString();
    let skippedProductCount = 0;
    let productsWithEmptyCleanedName = 0;
    let nameKeyCollisions = 0;
    let lowerNameKeyCollisions = 0;

    // To track which productId is associated with a name-based key
    const nameKeyOwner = {};
    const lowerNameKeyOwner = {};


    products.forEach((product, index) => {
        if ((index + 1) % 1000 === 0) {
            logReport(`Processing product ${index + 1}/${products.length}...`);
        }

        // Validate essential product fields
        if (!product.productId || typeof product.productId !== 'string') {
            logReport(`WARN: Skipping product at index ${index} due to missing or invalid productId. Product: ${JSON.stringify(product)}`);
            skippedProductCount++;
            return;
        }
        // Allow name to be potentially null or undefined initially, handle below
        const name = product.name || product.description || ''; // Use description as fallback for name
        if (typeof name !== 'string') {
            logReport(`WARN: Skipping product ID ${product.productId} at index ${index} due to invalid name (not a string). Name: ${product.name}, Description: ${product.description}`);
            skippedProductCount++;
            return;
        }
        if (!product.category || typeof product.category !== 'string' ||
            !product.subcategory // Can be null, but should exist
            // product.product_type can be null
        ) {
            logReport(`WARN: Skipping product ID ${product.productId} ("${name}") at index ${index} due to missing/invalid category, subcategory. Product: ${JSON.stringify(product)}`);
            skippedProductCount++;
            return;
        }
        // Ensure product_type is a string, even if it's an empty one when null
        const product_type_str = (product.product_type === null || product.product_type === undefined) ? "" : String(product.product_type);
        const subcategory_str = (product.subcategory === null || product.subcategory === undefined) ? "" : String(product.subcategory);


        const { productId, category } = product; // `name` is already defined and validated

        const cleanedName = name.replace(/[®™©]/g, '').trim();

        const correctionEntry = {
            category: category,
            subcategory: subcategory_str, // Use validated string
            product_type: product_type_str, // Use validated string
            last_verified: nowTimestamp,
            // Add a reference back to the source product ID for easier debugging of map entries
            source_productId: productId
        };

        // --- Key 1: productId:{{ID}} ---
        // This key is unique and guaranteed per valid product.
        const productIdKey = `productId:${productId}`;
        if (newCorrectionMap.hasOwnProperty(productIdKey)) {
            // This should ideally not happen if productIds are unique in categorized_products_sorted.json
            logReport(`CRITICAL WARN: Duplicate productId key detected: ${productIdKey}. Overwriting. Old entry for PID ${newCorrectionMap[productIdKey].source_productId}, New for PID ${productId}`);
        }
        newCorrectionMap[productIdKey] = { ...correctionEntry }; // Store a copy

        // --- Key 2: Cleaned product name (original case) ---
        if (cleanedName) {
            if (newCorrectionMap.hasOwnProperty(cleanedName)) {
                // Collision: Prioritize if the existing entry was from a product WITHOUT a productId
                // or if this new product seems "better" (e.g. has a brand, more specific category).
                // For now, simple overwrite but log it.
                logReport(`COLLISION (Name): Key "${cleanedName}" already exists (from PID: ${nameKeyOwner[cleanedName] || 'unknown'}). Overwriting with PID: ${productId}.`);
                nameKeyCollisions++;
            }
            newCorrectionMap[cleanedName] = { ...correctionEntry }; // Store a copy
            nameKeyOwner[cleanedName] = productId;
        } else {
            logReport(`WARN (Name): Product ID ${productId} has an empty name after cleaning. Original name: "${name}". Skipping original case name-based key.`);
            productsWithEmptyCleanedName++;
        }

        // --- Key 3: Cleaned product name (lowercase) ---
        if (cleanedName) {
            const lowerCleanName = cleanedName.toLowerCase();
            if (newCorrectionMap.hasOwnProperty(lowerCleanName) && lowerCleanName !== cleanedName) { // Avoid double logging if cleanedName was already lowercase
                logReport(`COLLISION (LowerName): Key "${lowerCleanName}" already exists (from PID: ${lowerNameKeyOwner[lowerCleanName] || nameKeyOwner[lowerCleanName] || 'unknown'}). Overwriting with PID: ${productId}.`);
                lowerNameKeyCollisions++;
            }
            newCorrectionMap[lowerCleanName] = { ...correctionEntry }; // Store a copy
            lowerNameKeyOwner[lowerCleanName] = productId;
        } else {
            // Warning already logged for empty cleanedName for the original case key
            if (!productsWithEmptyCleanedName) { // ensure we don't double count this type of warning
                logReport(`WARN (LowerName): Product ID ${productId} has an empty name after cleaning. Original name: "${name}". Skipping lowercase name-based key.`);
            }
        }
    });

    logReport(`--- Generation Summary ---`);
    logReport(`Total products read: ${products.length}`);
    logReport(`Products skipped due to missing/invalid fields: ${skippedProductCount}`);
    logReport(`Products with empty cleaned name (name-based keys potentially skipped): ${productsWithEmptyCleanedName}`);
    logReport(`Collisions on original case name key (overwritten): ${nameKeyCollisions}`);
    logReport(`Collisions on lowercase name key (overwritten, distinct from original case collisions): ${lowerNameKeyCollisions}`);
    logReport(`Total entries generated in correction map: ${Object.keys(newCorrectionMap).length}`);

    fs.writeFileSync(correctionMapPath, JSON.stringify(newCorrectionMap, null, 2));
    logReport(`Successfully wrote new correction map to ${correctionMapPath}`);
    logReport(`Detailed report log saved to: ${reportLogPath}`);

} catch (error) {
    logReport(`An error occurred: ${error.message}\n${error.stack}`);
    console.error('An error occurred (also logged to report file):', error);
    process.exit(1);
}