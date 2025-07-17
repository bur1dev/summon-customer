// process-fetched-data.js
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BATCH_SIZE = 20; // Match the batch size used in api_categorizer.js
const DELAY_BETWEEN_BATCHES_MS = 5000; // 5 second delay between batches
const API_URL = 'http://localhost:3000/api/categorize';
const PROGRESS_FILE = path.join(__dirname, 'categorization_progress.json');
const CATEGORIZED_PRODUCTS_PATH = path.join(__dirname, '../product-categorization/categorized_products.json');
const CATEGORIZED_SORTED_PATH = path.join(__dirname, '../product-categorization/categorized_products_sorted.json');

// Main function
async function processProductData() {
    let currentApiTaxonomyCacheName = null;
    // Check command line arguments
    if (process.argv.length < 3) {
        console.error('Usage: node process-fetched-data.js <path-to-product-json-file>');
        process.exit(1);
    }

    const productFilePath = process.argv[2];
    console.log(`Reading product data from: ${productFilePath}`);

    // Load product data
    let products;
    try {
        const data = fs.readFileSync(productFilePath, 'utf8');
        products = JSON.parse(data);
        console.log(`Loaded ${products.length} products from file.`);
    } catch (error) {
        console.error(`Error loading product data: ${error.message}`);
        process.exit(1);
    }

    // Load existing categorized products to avoid duplication
    let existingProductIds = new Set();
    try {
        // Check categorized_products.json first
        if (fs.existsSync(CATEGORIZED_PRODUCTS_PATH)) {
            const existingData = JSON.parse(fs.readFileSync(CATEGORIZED_PRODUCTS_PATH, 'utf8'));
            existingProductIds = new Set(existingData.map(p => p.productId));
            console.log(`Found ${existingProductIds.size} already categorized products in categorized_products.json`);
        }
        // Check categorized_products_sorted.json if the first file doesn't exist
        else if (fs.existsSync(CATEGORIZED_SORTED_PATH)) {
            const existingData = JSON.parse(fs.readFileSync(CATEGORIZED_SORTED_PATH, 'utf8'));
            existingProductIds = new Set(existingData.map(p => p.productId));
            console.log(`Found ${existingProductIds.size} already categorized products in categorized_products_sorted.json`);
        }
    } catch (error) {
        console.warn(`Error reading existing categorized products: ${error.message}`);
    }

    // Filter out already processed products
    const filteredProducts = products.filter(p => !p.productId || !existingProductIds.has(p.productId));
    console.log(`After filtering already processed products: ${filteredProducts.length} remain to process (${products.length - filteredProducts.length} skipped)`);

    if (filteredProducts.length === 0) {
        console.log('All products have already been categorized. Nothing to do.');
        process.exit(0);
    }

    // Load progress if exists
    let startIndex = 0;
    if (fs.existsSync(PROGRESS_FILE)) {
        try {
            const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
            if (progress.inputFile === productFilePath) {
                startIndex = progress.lastProcessedIndex + 1;
                console.log(`Resuming from index ${startIndex} (${startIndex} products already processed in this run).`);
            } else {
                console.log('Progress file is for a different input file. Starting from beginning.');
                // Reset progress file for new input
                fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
                    inputFile: productFilePath,
                    lastProcessedIndex: -1,
                    totalProducts: filteredProducts.length,
                    processedIds: [],
                    timestamp: new Date().toISOString()
                }));
            }
        } catch (error) {
            console.warn(`Error reading progress file: ${error.message}. Starting from beginning.`);
        }
    } else {
        // Create initial progress file
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
            inputFile: productFilePath,
            lastProcessedIndex: -1,
            totalProducts: filteredProducts.length,
            processedIds: [],
            timestamp: new Date().toISOString()
        }));
    }

    // Process products in batches
    const totalBatches = Math.ceil((filteredProducts.length - startIndex) / BATCH_SIZE);
    console.log(`Processing ${filteredProducts.length - startIndex} products in ${totalBatches} batches of ${BATCH_SIZE}...`);

    for (let i = startIndex; i < filteredProducts.length; i += BATCH_SIZE) {
        const batch = filteredProducts.slice(i, Math.min(i + BATCH_SIZE, filteredProducts.length));
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const batchEnd = Math.min(i + BATCH_SIZE - 1, filteredProducts.length - 1);

        console.log(`Processing batch ${batchNumber}/${totalBatches} (products ${i}-${batchEnd})...`);
        const apiRequestBody = {
            products: batch,
        };
        if (currentApiTaxonomyCacheName) {
            apiRequestBody.taxonomy_cache_name_from_client = currentApiTaxonomyCacheName;
        }
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(apiRequestBody), // Send the wrapped body
                timeout: 180000  // 3 minutes timeout for large batches
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API returned status ${response.status}: ${errorText}`);
            }

            const apiResponseData = await response.json();

            if (!apiResponseData || typeof apiResponseData.categorizedProducts === 'undefined' || typeof apiResponseData.taxonomy_cache_name === 'undefined') {
                console.error("API response did not contain expected structure (categorizedProducts and taxonomy_cache_name). Response:", JSON.stringify(apiResponseData, null, 2));
                throw new Error("Malformed API response structure.");
            }

            const result = apiResponseData.categorizedProducts;
            currentApiTaxonomyCacheName = apiResponseData.taxonomy_cache_name;

            console.log(`✅ Successfully categorized batch ${batchNumber}. Got ${result.length} categorized products.`);
            if (currentApiTaxonomyCacheName) {
                console.log(`ℹ️ Received and stored taxonomy_cache_name for next batch: ${currentApiTaxonomyCacheName}`);
            } else {
                console.log(`ℹ️ API did not return a taxonomy_cache_name this time.`);
            }


            // Track processed IDs
            const processedIds = batch.map(p => p.productId).filter(id => id);

            // Load current progress
            let progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));

            // Update progress
            progress.lastProcessedIndex = batchEnd;
            progress.processedIds = [...progress.processedIds, ...processedIds];
            progress.timestamp = new Date().toISOString();

            // Save progress
            fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));

            // Add delay before next batch
            if (i + BATCH_SIZE < filteredProducts.length) {
                console.log(`Waiting ${DELAY_BETWEEN_BATCHES_MS / 1000} seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
            }
        } catch (error) {
            console.error(`❌ Error processing batch ${batchNumber}: ${error.message}`);
            console.log(`Failed at index ${i}. You can resume from this point later.`);
            process.exit(1);
        }
    }

    console.log('✅ All products processed successfully!');
    console.log('The categorized products have been saved to:');
    console.log('  - categorized_products.json');
    console.log('  - categorized_products_sorted.json (sorted version)');
    console.log('\nTo upload these to your Holochain DHT, open your app and use the loadFromSavedData() function.');

    // Clean up progress file if complete
    fs.unlinkSync(PROGRESS_FILE);
    console.log('Removed progress file as processing is complete.');
}

// Run the main function
processProductData().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});