// compare_json_files.cjs
const fs = require('fs');
const path = require('path');

const sortedFilePath = path.join(__dirname, '../../product-categorization/categorized_products_sorted.json');
const embeddedFilePath = path.join(__dirname, '../../product-categorization/categorized_products_sorted_with_embeddings.json');

function loadAndParse(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`ERROR: File not found: ${filePath}`);
        return null;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        console.error(`ERROR: Could not parse ${filePath}: ${e.message}`);
        return null;
    }
}

const sortedProducts = loadAndParse(sortedFilePath);
const embeddedProducts = loadAndParse(embeddedFilePath);

if (!sortedProducts || !embeddedProducts) {
    process.exit(1);
}

if (!Array.isArray(sortedProducts) || !Array.isArray(embeddedProducts)) {
    console.error("ERROR: One or both files do not contain a valid JSON array.");
    process.exit(1);
}

console.log(`--- File Comparison Report ---`);
console.log(`Count in categorized_products_sorted.json:           ${sortedProducts.length}`);
console.log(`Count in categorized_products_sorted_with_embeddings.json: ${embeddedProducts.length}`);

if (sortedProducts.length !== embeddedProducts.length) {
    console.warn("\nWARNING: Product counts differ between the files!");
} else {
    console.log("\nProduct counts are identical.");
}

// Create maps for easier lookup by productId
const sortedMap = new Map(sortedProducts.map(p => [p.productId, p]));
const embeddedMap = new Map(embeddedProducts.map(p => [p.productId, p]));

let missingInEmbedded = 0;
for (const id of sortedMap.keys()) {
    if (!embeddedMap.has(id)) {
        missingInEmbedded++;
        if (missingInEmbedded < 6) console.log(`  - Product ID ${id} from 'sorted' is MISSING in 'embedded'.`);
    }
}
if (missingInEmbedded > 0) console.warn(`WARNING: ${missingInEmbedded} products from 'sorted' are missing in 'embedded'.`);

let missingInSorted = 0;
for (const id of embeddedMap.keys()) {
    if (!sortedMap.has(id)) {
        missingInSorted++;
        if (missingInSorted < 6) console.log(`  - Product ID ${id} from 'embedded' is MISSING in 'sorted'.`);
    }
}
if (missingInSorted > 0) console.warn(`WARNING: ${missingInSorted} products from 'embedded' are missing in 'sorted'.`);

if (sortedProducts.length === embeddedProducts.length && missingInEmbedded === 0 && missingInSorted === 0) {
    console.log("\nAll product IDs match between files.");
    console.log("Checking for categorization differences in matching products...");

    let catDifferences = 0;
    let addCatDifferences = 0;
    let otherFieldDifferences = 0; // Basic check for price/name for example

    for (const productFromSorted of sortedProducts) {
        const productId = productFromSorted.productId;
        const productFromEmbedded = embeddedMap.get(productId);

        if (productFromEmbedded) { // Should always be true if counts and IDs match
            let diffFoundForThisProduct = false;
            // Compare primary categorization
            if (productFromSorted.category !== productFromEmbedded.category ||
                (productFromSorted.subcategory || null) !== (productFromEmbedded.subcategory || null) ||
                (productFromSorted.product_type || null) !== (productFromEmbedded.product_type || null)) {
                catDifferences++;
                if (catDifferences < 4) {
                    console.log(`  - PID ${productId}: Primary C/S/PT differs.`);
                    console.log(`    Sorted:   ${productFromSorted.category} / ${productFromSorted.subcategory || 'null'} / ${productFromSorted.product_type || 'null'}`);
                    console.log(`    Embedded: ${productFromEmbedded.category} / ${productFromEmbedded.subcategory || 'null'} / ${productFromEmbedded.product_type || 'null'}`);
                }
                diffFoundForThisProduct = true;
            }

            // Compare additional_categorizations (simple length check, then stringify for deeper)
            const sortedAddCats = productFromSorted.additional_categorizations || [];
            const embeddedAddCats = productFromEmbedded.additional_categorizations || [];
            if (JSON.stringify(sortedAddCats) !== JSON.stringify(embeddedAddCats)) {
                addCatDifferences++;
                if (addCatDifferences < 4 && !diffFoundForThisProduct) { // Log only if primary was same
                    console.log(`  - PID ${productId}: additional_categorizations differ.`);
                }
                diffFoundForThisProduct = true;
            }

            // Example: Check name and price for differences
            if (productFromSorted.name !== productFromEmbedded.name || productFromSorted.price !== productFromEmbedded.price) {
                otherFieldDifferences++;
                if (otherFieldDifferences < 4 && !diffFoundForThisProduct) {
                    console.log(`  - PID ${productId}: Name or Price differs.`);
                }
            }
        }
    }
    if (catDifferences > 0) console.warn(`\nWARNING: ${catDifferences} products have different primary categorizations.`);
    if (addCatDifferences > 0) console.warn(`WARNING: ${addCatDifferences} products have different additional_categorizations.`);
    if (otherFieldDifferences > 0) console.warn(`WARNING: ${otherFieldDifferences} products have different name/price (examples).`);
    if (catDifferences === 0 && addCatDifferences === 0 && otherFieldDifferences === 0) {
        console.log("\nCategorization data and key fields appear consistent for all matching products.");
    }
}
console.log(`--- End of Report ---`);