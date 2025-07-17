const fs = require('fs');
const path = require('path');

// Path to the JSON file, relative to this script's location
// This script is in: /home/bur1/Holochain/summon/backend/manual_task_scripts/
// The data file is in: /home/bur1/Holochain/summon/product-categorization/
// So we need to go up two directories (../../) then into product-categorization
const dataFilePath = path.join(__dirname, '../../product-categorization/categorized_products_sorted.json');

// You could also use the absolute path directly, but relative is often more portable within a project
// const dataFilePath = '/home/bur1/Holochain/summon/product-categorization/categorized_products_sorted.json';

console.log(`Attempting to read file from: ${dataFilePath}`);

try {
    // Read the file content
    const fileContent = fs.readFileSync(dataFilePath, 'utf8');

    // Parse the JSON data
    // Assuming the JSON file contains an array of product objects
    const products = JSON.parse(fileContent);

    if (!Array.isArray(products)) {
        console.error('Error: The JSON file does not contain an array of products.');
        process.exit(1); // Exit with an error code
    }

    const uniqueProductTypes = new Set();

    for (const product of products) {
        // Check if the product object exists and has the 'product_type' property
        if (product && typeof product.product_type === 'string') {
            uniqueProductTypes.add(product.product_type);
        } else if (product && product.product_type === null) {
            // Optionally, handle null product_types if they should be counted or noted
            // For now, we'll treat null as a distinct type if present, or ignore it
            // To specifically count 'null' as a type:
            // uniqueProductTypes.add('null_product_type_value');
            // Or if you want to ignore products with null product_type, do nothing here.
            // Current behavior: if product_type is literally null, it won't be added because of `typeof ... === 'string'`.
            // If you want to count 'null' (the string "null") or an actual null value distinctly:
            if (product.hasOwnProperty('product_type')) { // Check if the key exists
                uniqueProductTypes.add(String(product.product_type)); // Convert null or undefined to string "null" or "undefined"
            }
        }
        // You might want to add a warning for products missing the 'product_type' key altogether
        // else if (product && !product.hasOwnProperty('product_type')) {
        //    console.warn(`Warning: Product with ID ${product.productId || 'Unknown'} is missing 'product_type' field.`);
        // }
    }

    console.log(`Total number of products processed: ${products.length}`);
    console.log(`Number of unique product types: ${uniqueProductTypes.size}`);

    // If you want to see the list of unique product types:
    // console.log("\nUnique Product Types Found:");
    // uniqueProductTypes.forEach(type => console.log(`- ${type}`));

} catch (error) {
    console.error('An error occurred:');
    if (error.code === 'ENOENT') {
        console.error(`File not found at ${dataFilePath}. Please check the path.`);
    } else if (error instanceof SyntaxError) {
        console.error('Failed to parse JSON. The file might be corrupted or not in valid JSON format.');
        console.error('Details:', error.message);
    } else {
        console.error(error.message);
    }
    process.exit(1); // Exit with an error code
}