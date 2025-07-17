const fs = require('fs');
const path = require('path');
const ProductCategorizer = require('../api_categorizer');

// Get API key from environment or .env file
require('dotenv').config();
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error('Missing GEMINI_API_KEY. Set it in your environment or .env file');
    process.exit(1);
}

async function main() {
    try {
        // Parse command line args
        const args = process.argv.slice(2);
        const inputFile = args[0] || 'products.json';
        const batchSize = parseInt(args[1], 10) || 20;

        if (!fs.existsSync(inputFile)) {
            console.error(`Input file not found: ${inputFile}`);
            process.exit(1);
        }

        // Load products
        const products = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
        console.log(`Loaded ${products.length} products from ${inputFile}`);

        // Create categorizer
        const categorizer = new ProductCategorizer(apiKey);

        // Process products
        console.log(`Starting categorization with batch size ${batchSize}...`);
        const startTime = Date.now();

        const results = await categorizer.categorizeProducts(products, batchSize);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`Categorization completed in ${duration}s. Processed ${results.length}/${products.length} products.`);

        // Save results
        const outputFile = `categorized_${path.basename(inputFile)}`;
        fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
        console.log(`Results saved to ${outputFile}`);

        // Report statistics
        const categoryCounts = {};
        results.forEach(product => {
            const cat = product.category || 'Uncategorized';
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });

        console.log('\nCategory distribution:');
        Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([category, count]) => {
                console.log(`- ${category}: ${count} (${(count / results.length * 100).toFixed(1)}%)`);
            });

        // Report dual categorization stats
        const dualCount = results.filter(p => p.dual_categorization).length;
        console.log(`\nDual categorizations: ${dualCount} (${(dualCount / results.length * 100).toFixed(1)}%)`);

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();