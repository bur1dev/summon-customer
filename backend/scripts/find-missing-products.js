// find-missing-products.js
import fs from 'fs';
import path from 'path';

// Check command line arguments
if (process.argv.length < 4) {
    console.error('Usage: node find-missing-products.js <path-to-kroger-data.json> <path-to-categorized-products.json>');
    process.exit(1);
}

const krogerDataPath = process.argv[2];
const categorizedDataPath = process.argv[3];

console.log(`Reading Kroger data from: ${krogerDataPath}`);
console.log(`Reading categorized data from: ${categorizedDataPath}`);

// Load files
let krogerData, categorizedData;

try {
    krogerData = JSON.parse(fs.readFileSync(krogerDataPath, 'utf8'));
    console.log(`Original Kroger data: ${krogerData.length} products`);
} catch (error) {
    console.error(`Error loading Kroger data: ${error.message}`);
    process.exit(1);
}

try {
    categorizedData = JSON.parse(fs.readFileSync(categorizedDataPath, 'utf8'));
    console.log(`Categorized data: ${categorizedData.length} products`);
} catch (error) {
    console.error(`Error loading categorized data: ${error.message}`);
    process.exit(1);
}

// Create a Set of productIds that were categorized
const categorizedProductIds = new Set(categorizedData.map(product => product.productId));

// Find missing products
const missingProducts = krogerData.filter(product => !categorizedProductIds.has(product.productId));

console.log(`Found ${missingProducts.length} missing products`);

// Log some details about missing products
if (missingProducts.length > 0) {
    console.log('\nSample missing products:');
    missingProducts.slice(0, 5).forEach(product => {
        console.log(`- ${product.description} (ID: ${product.productId})`);
    });

    // Save missing products to a new file
    const timestamp = Date.now();
    const outputFile = path.join(path.dirname(krogerDataPath), `missing_products_${timestamp}.json`);

    fs.writeFileSync(outputFile, JSON.stringify(missingProducts, null, 2));
    console.log(`\nMissing products saved to: ${outputFile}`);
    console.log(`\nTo reprocess these products, run:`);
    console.log(`node process-fetched-data.js ${outputFile}`);
} else {
    console.log('\nNo missing products found. All products were successfully categorized.');
}

// Additional statistics
console.log('\nSummary:');
console.log(`Original products: ${krogerData.length}`);
console.log(`Categorized products: ${categorizedData.length}`);
console.log(`Missing products: ${missingProducts.length}`);
console.log(`Success rate: ${((categorizedData.length / krogerData.length) * 100).toFixed(2)}%`);