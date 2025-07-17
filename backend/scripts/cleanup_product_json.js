// backend/scripts/cleanup_product_json.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process'; // Using spawnSync for simplicity here

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const categorizedProductsPath = path.join(__dirname, '../../product-categorization/categorized_products.json');
const categorizedProductsSortedPath = path.join(__dirname, '../../product-categorization/categorized_products_sorted.json');

function runCleanup() {
    if (!fs.existsSync(categorizedProductsPath)) {
        console.error(`File not found: ${categorizedProductsPath}. Cannot cleanup.`);
        return;
    }

    console.log(`Reading products from ${categorizedProductsPath}...`);
    let products;
    try {
        products = JSON.parse(fs.readFileSync(categorizedProductsPath, 'utf8'));
    } catch (e) {
        console.error(`Error parsing ${categorizedProductsPath}: ${e.message}`);
        return;
    }

    if (!Array.isArray(products)) {
        console.error(`${categorizedProductsPath} does not contain a valid JSON array.`);
        return;
    }

    console.log(`Found ${products.length} products. Starting cleanup...`);
    let updatedCount = 0;

    const cleanedProducts = products.map(product => {
        const updatedProduct = { ...product }; // Work on a copy
        let productWasUpdated = false;

        // 1. Normalize 'price'
        if (typeof updatedProduct.price !== 'number') { // If top-level price is not a number (or missing)
            const nestedPrice = updatedProduct.items?.[0]?.price?.regular;
            if (typeof nestedPrice === 'number') {
                updatedProduct.price = nestedPrice;
                productWasUpdated = true;
            } else if (typeof updatedProduct.price === 'undefined') { // Ensure it's at least 0 if no source
                updatedProduct.price = 0;
                // productWasUpdated = true; // Only count as update if it changed from undefined to 0 based on missing nested
            }
        }

        // 2. Normalize 'promo_price' (to null if 0, undefined, or not a number)
        const currentTopLevelPromo = updatedProduct.promo_price;
        const nestedPromo = updatedProduct.items?.[0]?.price?.promo;
        let newPromoPrice = null;

        if (typeof currentTopLevelPromo === 'number' && currentTopLevelPromo !== 0) {
            newPromoPrice = currentTopLevelPromo;
        } else if (typeof nestedPromo === 'number' && nestedPromo !== 0) {
            newPromoPrice = nestedPromo;
        }
        if (updatedProduct.promo_price !== newPromoPrice) {
            updatedProduct.promo_price = newPromoPrice;
            productWasUpdated = true;
        }


        // 3. Normalize 'size'
        if ((!updatedProduct.size || typeof updatedProduct.size !== 'string') && typeof updatedProduct.items?.[0]?.size === 'string') {
            updatedProduct.size = updatedProduct.items[0].size;
            productWasUpdated = true;
        } else if (typeof updatedProduct.size === 'undefined') {
            updatedProduct.size = "";
            // productWasUpdated = true;
        }

        // 4. Normalize 'stocks_status'
        if ((!updatedProduct.stocks_status || typeof updatedProduct.stocks_status !== 'string') && typeof updatedProduct.items?.[0]?.inventory?.stockLevel === 'string') {
            updatedProduct.stocks_status = updatedProduct.items[0].inventory.stockLevel;
            productWasUpdated = true;
        } else if (typeof updatedProduct.stocks_status === 'undefined') {
            updatedProduct.stocks_status = "UNKNOWN";
            // productWasUpdated = true;
        }

        // 5. Normalize 'image_url'
        if ((!updatedProduct.image_url || typeof updatedProduct.image_url !== 'string') && updatedProduct.images) {
            const newImageUrl = updatedProduct.images.find(img => img.perspective === "front")?.sizes?.find(s => s.size === "large")?.url || null;
            if (updatedProduct.image_url !== newImageUrl) {
                updatedProduct.image_url = newImageUrl;
                productWasUpdated = true;
            }
        } else if (typeof updatedProduct.image_url === 'undefined') {
            updatedProduct.image_url = null;
            // productWasUpdated = true;
        }

        // 6. Normalize 'sold_by'
        if ((!updatedProduct.sold_by || typeof updatedProduct.sold_by !== 'string') && typeof updatedProduct.items?.[0]?.soldBy === 'string') {
            updatedProduct.sold_by = updatedProduct.items[0].soldBy;
            productWasUpdated = true;
        } else if (typeof updatedProduct.sold_by === 'undefined') {
            updatedProduct.sold_by = null;
            // productWasUpdated = true;
        }

        // 7. Ensure 'name' and 'description' consistency (important)
        const currentName = updatedProduct.name || "";
        const currentDesc = updatedProduct.description || "";
        let nameChanged = false;
        if (!currentName && currentDesc) { updatedProduct.name = currentDesc; nameChanged = true; }
        else if (!currentDesc && currentName) { updatedProduct.description = currentName; nameChanged = true; }
        else if (!currentName && !currentDesc) { // Default if both truly missing
            updatedProduct.name = "Unknown Product";
            updatedProduct.description = "Unknown Product";
            nameChanged = true;
        }
        if (nameChanged) productWasUpdated = true;


        // 8. Ensure 'additional_categorizations' array exists
        if (!Array.isArray(updatedProduct.additional_categorizations)) {
            updatedProduct.additional_categorizations = [];
            productWasUpdated = true;
        }

        // 9. Ensure '_categoryChanged' and related flags are consistent
        if (typeof updatedProduct._categoryChanged !== 'boolean') {
            updatedProduct._categoryChanged = false; // Default to false if missing
            productWasUpdated = true;
        }
        // If _categoryChanged is false, ensure original fields are null
        if (updatedProduct._categoryChanged === false) {
            if (updatedProduct._originalCategory !== null) { updatedProduct._originalCategory = null; productWasUpdated = true; }
            if (updatedProduct._originalSubcategory !== null) { updatedProduct._originalSubcategory = null; productWasUpdated = true; }
            if (updatedProduct._originalProductType !== null) { updatedProduct._originalProductType = null; productWasUpdated = true; }
            if (updatedProduct._originalAdditionalCategorizations !== null) { updatedProduct._originalAdditionalCategorizations = null; productWasUpdated = true; }
        } else { // If _categoryChanged is true, ensure the original fields exist (even if null, which is fine)
            if (updatedProduct._originalCategory === undefined) { updatedProduct._originalCategory = null; productWasUpdated = true; }
            if (updatedProduct._originalSubcategory === undefined) { updatedProduct._originalSubcategory = null; productWasUpdated = true; }
            if (updatedProduct._originalProductType === undefined) { updatedProduct._originalProductType = null; productWasUpdated = true; }
            if (updatedProduct._originalAdditionalCategorizations === undefined) { updatedProduct._originalAdditionalCategorizations = null; productWasUpdated = true; }
        }

        if (typeof updatedProduct.brand !== 'string' && updatedProduct.brand !== null) {
            updatedProduct.brand = null;
            productWasUpdated = true;
        }

        // 11. Normalize 'is_organic'
        if (typeof updatedProduct.is_organic !== 'boolean') {
            updatedProduct.is_organic = false;
            productWasUpdated = true;
        }


        if (productWasUpdated) {
            updatedCount++;
        }
        return updatedProduct;
    });

    if (updatedCount > 0) {
        console.log(`Made updates to ${updatedCount} product(s) for consistency.`);
        // Backup the original file
        const backupPath = `${categorizedProductsPath}.bak.${Date.now()}`;
        fs.copyFileSync(categorizedProductsPath, backupPath);
        console.log(`Backed up original file to ${backupPath}`);

        // Write the cleaned data
        fs.writeFileSync(categorizedProductsPath, JSON.stringify(cleanedProducts, null, 2));
        console.log(`Cleaned data written to ${categorizedProductsPath}`);

        // Re-run the sort script
        console.log(`Re-sorting products...`);
        const sortResult = spawnSync('python3', ['sort_products.py', categorizedProductsPath], {
            cwd: path.join(__dirname, '../../product-categorization/'),
            stdio: 'inherit' // Show sort script output directly
        });

        if (sortResult.status === 0) {
            console.log(`Successfully re-sorted products. Check ${categorizedProductsSortedPath}.`);
        } else {
            console.error(`Error re-sorting products. Exit code: ${sortResult.status}`);
        }
    } else {
        console.log("No products required updates for basic field consistency.");
    }

    console.log("Cleanup script finished.");
}

runCleanup();