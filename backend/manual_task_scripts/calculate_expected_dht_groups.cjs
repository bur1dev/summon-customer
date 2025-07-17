// calculate_expected_dht_groups.cjs
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
// Ensure this matches the value in your products.rs Zome code
const PRODUCTS_PER_GROUP = 1000;
const DATA_FILE_PATH = path.join(__dirname, '../../product-categorization/categorized_products_sorted_with_embeddings.json'); // Adjust path if needed
// --- END CONFIGURATION ---

function normalizeProductKey(product) {
    const category = product.category || "Unknown Category"; // Should always have a category
    const subcategory = product.subcategory || null;
    const productType = (product.product_type === "All" || !product.product_type || product.product_type === "") ? null : product.product_type;
    return `${category}|||${subcategory}|||${productType}`;
}

try {
    console.log(`Reading data from: ${DATA_FILE_PATH}`);
    if (!fs.existsSync(DATA_FILE_PATH)) {
        console.error(`ERROR: Data file not found at ${DATA_FILE_PATH}`);
        process.exit(1);
    }

    const fileContent = fs.readFileSync(DATA_FILE_PATH, 'utf8');
    const allProducts = JSON.parse(fileContent);

    if (!Array.isArray(allProducts)) {
        console.error('ERROR: Parsed data is not an array.');
        process.exit(1);
    }

    console.log(`Total products loaded from file: ${allProducts.length}`);

    const productsByPrimaryKey = allProducts.reduce((groups, product) => {
        const key = normalizeProductKey(product);
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(product);
        return groups;
    }, {});

    let expectedDhtGroups = 0;
    const primaryTypeCount = Object.keys(productsByPrimaryKey).length;

    console.log(`\nFound ${primaryTypeCount} unique primary (category/subcategory/product_type) combinations.`);
    console.log(`Calculating expected DHT groups based on PRODUCTS_PER_GROUP = ${PRODUCTS_PER_GROUP}`);
    console.log("--------------------------------------------------------------------------");
    console.log("Primary Key                               | Product Count | DHT Groups for this Key");
    console.log("--------------------------------------------------------------------------");

    for (const key in productsByPrimaryKey) {
        const productsInGroup = productsByPrimaryKey[key].length;
        const dhtGroupsForThisKey = Math.ceil(productsInGroup / PRODUCTS_PER_GROUP);
        expectedDhtGroups += dhtGroupsForThisKey;

        // For cleaner logging, truncate long keys
        const displayKey = key.length > 45 ? key.substring(0, 42) + "..." : key;
        console.log(`${displayKey.padEnd(47)} | ${String(productsInGroup).padStart(13)} | ${String(dhtGroupsForThisKey).padStart(22)}`);
    }
    console.log("--------------------------------------------------------------------------");
    console.log(`\nTOTAL EXPECTED DHT PRODUCT GROUPS: ${expectedDhtGroups}`);
    console.log("--------------------------------------------------------------------------");


} catch (error) {
    console.error('Error during script execution:', error);
    process.exit(1);
}