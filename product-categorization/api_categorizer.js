const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Use a specific Python executable path or rely on environment
const pythonExecutable = process.env.PYTHON_EXECUTABLE || '/home/bur1/Holochain/summon/product-categorization/venv/bin/python3';
const wrapperScriptPath = path.join(__dirname, 'gemini_wrapper.py');
const dualBridgeScriptPath = path.join(__dirname, 'dual_bridge.py');

class ProductCategorizer {
    constructor(apiKey) {
        console.log(`API Key loaded (first 4 chars): ${apiKey.substring(0, 4)}...`);
        this.apiKey = apiKey;
        this.correctionMap = this.loadCorrectionMap();
        this.DUAL_CATEGORY_MAPPINGS = this.loadDualCategoryMappings();

        // Process categories into minimal format
        const rawData = JSON.parse(fs.readFileSync(path.join(__dirname, 'categories.json'), 'utf8'));
        this.categoryData = this.processCategories(rawData);

        // Set the API key as an environment variable for the Python process
        process.env.GEMINI_API_KEY = this.apiKey;
        this.currentTaxonomyCacheName = null;
    }

    loadCorrectionMap() {
        try {
            const mapFile = path.join(__dirname, 'correction_map.json');
            if (fs.existsSync(mapFile)) {
                return JSON.parse(fs.readFileSync(mapFile, 'utf8'));
            }
        } catch (err) {
            console.error('Error loading correction map:', err);
        }
        return {};
    }

    // New method to load dual category mappings
    loadDualCategoryMappings() {
        try {
            // Try to load from dual_category_mappings.json first
            const mappingsPath = path.join(__dirname, 'dual_category_mappings.json');
            if (fs.existsSync(mappingsPath)) {
                return JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
            }

            // If file doesn't exist, extract mappings from dual_categories.py
            // This is a simplified fallback that extracts a small subset of mappings
            console.log('Dual category mappings file not found, extracting from dual_categories.py');
            const mappings = this.extractDualCategoryMappingsFromPy();

            // Save the extracted mappings for future use
            if (Object.keys(mappings).length > 0) {
                fs.writeFileSync(mappingsPath, JSON.stringify(mappings, null, 2));
                console.log(`Saved ${Object.keys(mappings).length} dual category mappings to ${mappingsPath}`);
            }

            return mappings;
        } catch (err) {
            console.error('Error loading dual category mappings:', err);
            return {};
        }
    }

    // Helper method to extract mappings from Python file
    extractDualCategoryMappingsFromPy() {
        const dummyMappings = {
            "Beverages": {
                "Milk": {
                    "dual_category": "Dairy & Eggs"
                }
            },
            "Dairy & Eggs": {
                "Milk": {
                    "dual_category": "Beverages"
                },
                "Cheese": {
                    "dual_category": "Deli"
                }
            }
        };

        // In a real implementation, you would parse dual_categories.py here
        return dummyMappings;
    }

    processCategories(categories) {
        return categories.map(cat => ({
            name: cat.name,
            subcategories: cat.subcategories.map(sub => ({
                name: sub.name,
                gridOnly: sub.gridOnly || false,
                productTypes: sub.productTypes || []
            }))
        }));
    }

    logFailedCategorization(product, error = null, attemptedCategory = null, context = "") {
        const failedFile = path.join(__dirname, 'failed_categorizations.jsonl');
        const logEntry = {
            description: product.description || product.id || "Unknown product",
            productId: product.productId,
            context: context,
            error_message: error ? error.message : undefined,
            attempted_category: attemptedCategory || undefined,
            kroger_categories: product.categories || [],
            timestamp: new Date().toISOString()
        };
        Object.keys(logEntry).forEach(key => logEntry[key] === undefined && delete logEntry[key]);
        try {
            fs.appendFileSync(failedFile, JSON.stringify(logEntry) + '\n');
            console.error(`Logged failed categorization for: ${logEntry.description} (Context: ${context}, PID: ${product.productId || 'N/A'})`);
        } catch (err) {
            console.error('Failed to log categorization failure:', err);
        }
    }

    logCategoryCorrection(product, correctionData) {
        const logFile = path.join(__dirname, 'category_corrections.jsonl');

        const logEntry = {
            description: product.description,
            original_categorization: correctionData.original,
            corrected_categorization: correctionData.corrected,
            alternative_categories: correctionData.alternatives,
            confidence: correctionData.confidence,
            reason: correctionData.reason || "auto_correction",
            kroger_categories: product.categories || [],
            timestamp: new Date().toISOString(),
            type: "category_correction"
        };

        // Log to console
        console.log(`🔄 Auto-correction: ${product.description} - ${correctionData.original.category}→${correctionData.corrected?.category || "AMBIGUOUS"}`);

        try {
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        } catch (err) {
            console.error('Failed to log category correction:', err);
        }
    }

    async categorizeProducts(products, batchSize = 20) {
        console.log(`[API_CATEGORIZER START] Received products array of length: ${products.length}`);

        // Add is_organic flag based on product.categories
        for (const product of products) {
            if (product.categories && Array.isArray(product.categories) && product.categories.includes("Natural & Organic")) {
                product.is_organic = true;
            } else {
                // Ensure the field exists, even if false, for consistent data structure
                product.is_organic = false;
            }
        }
        // Log if any product was marked as organic
        const organicProductsCount = products.filter(p => p.is_organic).length;
        if (organicProductsCount > 0) {
            console.log(`[API_CATEGORIZER] Marked ${organicProductsCount} products as is_organic.`);
        }

        const processedProductsCollector = []; // Use a single collector for all products that go through the full pipeline
        const failedProducts = [];

        const productsForLLMOrDirectDual = []; // Products not fully resolved by correction map OR needing dual despite map match
        const productsFromCorrectionMapOnly = []; // Products fully resolved by map AND NOT needing dual

        console.log(`Processing ${products.length} products through categorization pipeline`);
        console.log(`Checking against correction map with ${Object.keys(this.correctionMap).length} entries`);

        for (const product of products) {
            if (product.force_llm === true) {
                console.log(`Product ${product.description || product.productId} has force_llm flag, skipping correction map, will go to LLM then dual.`);
                productsForLLMOrDirectDual.push(product);
                continue;
            }

            const potentialKeys = this.getPotentialCorrectionMapKeys(product);
            let correctionMapEntry = null;
            let matchedKey = null;

            for (const key of potentialKeys) {
                if (this.correctionMap[key]) {
                    correctionMapEntry = this.correctionMap[key];
                    matchedKey = key;
                    break;
                }
            }

            if (correctionMapEntry) {
                console.log(`Correction map match for: ${product.description || product.productId} via key: ${matchedKey}`);
                const enrichedProduct = {
                    ...product,
                    category: correctionMapEntry.category,
                    subcategory: correctionMapEntry.subcategory,
                    product_type: correctionMapEntry.product_type,
                    // Ensure additional_categorizations field exists, even if empty, for consistency before dual check
                    additional_categorizations: product.additional_categorizations || []
                };

                if (this.categoryNeedsDualMapping(correctionMapEntry.category, correctionMapEntry.subcategory)) {
                    console.log(`Product from correction map (new primary: ${correctionMapEntry.category}/${correctionMapEntry.subcategory}) needs dual categorization: ${product.description || product.productId}`);
                    productsForLLMOrDirectDual.push(enrichedProduct); // This product (with primary from map) needs full dual/multi processing
                } else {
                    console.log(`Product from correction map (primary: ${correctionMapEntry.category}/${correctionMapEntry.subcategory}) does NOT need further dual categorization: ${product.description || product.productId}`);
                    // This product is considered final from the map, ensure additional_categorizations is an empty array if not present
                    if (!enrichedProduct.hasOwnProperty('additional_categorizations')) {
                        enrichedProduct.additional_categorizations = [];
                    }
                    productsFromCorrectionMapOnly.push(enrichedProduct);
                }
            } else {
                console.log(`Product ${product.description || product.productId} not in correction map, will go to LLM then dual.`);
                productsForLLMOrDirectDual.push(product);
            }
        }

        console.log(`[API_CATEGORIZER PRE-BATCH] Products fully resolved by correction map (no dual needed): ${productsFromCorrectionMapOnly.length}`);
        console.log(`[API_CATEGORIZER PRE-BATCH] Products needing LLM and/or Dual/Multi processing: ${productsForLLMOrDirectDual.length}`);

        // Process products needing LLM (if any from productsForLLMOrDirectDual were not from correction map)
        // and then ALL products in productsForLLMOrDirectDual (which now includes LLM results and map-derived ones needing dual)
        // through the dual/multi categorization pipeline.

        const productsToActuallyCategorize = []; // This will hold products after initial LLM if they were unknown

        // Separate out those that truly need LLM for primary category vs those from map just needing dual
        const productsNeedingPrimaryLLM = productsForLLMOrDirectDual.filter(p => {
            // A product needs primary LLM if it wasn't from the correction map path
            // (i.e., its current C/S/PT isn't from a correctionMapEntry that was just applied)
            // This is a bit tricky here as `productsForLLMOrDirectDual` mixes them.
            // A simpler way: if it was originally in `unknownProducts` (before this refactor).
            // Let's assume `processBatchWithRetry` handles primary categorization if needed.
            // For products already having C/S/PT from correction map, `processBatchWithRetry` should respect it if no `force_llm`.
            // The main goal of this block is to get primary C/S/PT for those that don't have it from map.
            let needsLLM = true;
            if (p.force_llm) return true; // Definitely needs LLM
            const potentialKeys = this.getPotentialCorrectionMapKeys(p);
            for (const key of potentialKeys) {
                if (this.correctionMap[key]) {
                    needsLLM = false; // Found in map, primary is set, might only need dual
                    break;
                }
            }
            return needsLLM;
        });

        const productsFromMapNeedingOnlyDual = productsForLLMOrDirectDual.filter(p => !productsNeedingPrimaryLLM.includes(p));

        console.log(`[API_CATEGORIZER LLM-SPLIT] Products needing primary LLM: ${productsNeedingPrimaryLLM.length}`);
        console.log(`[API_CATEGORIZER LLM-SPLIT] Products from map (primary set) needing only dual/multi: ${productsFromMapNeedingOnlyDual.length}`);

        if (productsNeedingPrimaryLLM.length > 0) {
            for (let i = 0; i < productsNeedingPrimaryLLM.length; i += batchSize) {
                const batch = productsNeedingPrimaryLLM.slice(i, i + batchSize);
                console.log(`Processing LLM batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(productsNeedingPrimaryLLM.length / batchSize)} for primary categorization`);
                try {
                    const batchResultsLLM = await this.processBatchWithRetry(batch); // Gets primary C/S/PT
                    productsToActuallyCategorize.push(...batchResultsLLM);
                } catch (error) {
                    console.error(`Failed processing LLM batch starting at index ${i}: ${error.message}`);
                    failedProducts.push(...batch);
                    batch.forEach(failed_p => this.logFailedCategorization(failed_p, error, null, "categorizeProducts_llm_batch_loop"));
                }
            }
        }

        // Add products that came from correction map but still need dual processing
        productsToActuallyCategorize.push(...productsFromMapNeedingOnlyDual);

        console.log(`[API_CATEGORIZER DUAL-INPUT] Total products for applyDualCategorization: ${productsToActuallyCategorize.length}`);

        // Now, all products in productsToActuallyCategorize have a primary C/S/PT.
        // Run them ALL through applyDualCategorization.
        if (productsToActuallyCategorize.length > 0) {
            console.log(`Applying dual/multi categorization to ${productsToActuallyCategorize.length} products`);
            try {
                const dualMultiCategorizedProducts = await this.applyDualCategorization(productsToActuallyCategorize);
                // These products now have their .additional_categorizations field correctly populated (or as empty array).
                processedProductsCollector.push(...dualMultiCategorizedProducts);
                console.log(`Dual/multi categorization complete. Got ${dualMultiCategorizedProducts.length} products back into collector.`);
            } catch (error) {
                console.error(`Failed during dual/multi categorization: ${error.message}`);
                // Add them to collector as is, they'll be missing additional_categorizations
                processedProductsCollector.push(...productsToActuallyCategorize.map(p => ({ ...p, additional_categorizations: p.additional_categorizations || [] })));
                productsToActuallyCategorize.forEach(p_fail_dual => this.logFailedCategorization(p_fail_dual, error, { category: p_fail_dual.category, subcategory: p_fail_dual.subcategory }, "categorizeProducts_dual_multi_failed"));
            }
        }

        // Add products that were fully resolved by correction map and didn't need any dual/multi processing
        processedProductsCollector.push(...productsFromCorrectionMapOnly.map(p => ({ ...p, additional_categorizations: p.additional_categorizations || [] })));

        console.log(`[API_CATEGORIZER FINAL] Total products processed and collected: ${processedProductsCollector.length}`);

        if (failedProducts.length > 0) {
            console.log(`Total failed to categorize (during LLM primary): ${failedProducts.length} products.`);
            this.logFailedProducts(failedProducts); // This logs to failed_products.json
        }

        // Ensure all returned products have the additional_categorizations field, even if empty
        const finalOutput = processedProductsCollector.map(p => ({
            ...p,
            additional_categorizations: p.additional_categorizations || []
        }));

        console.log(`[API_CATEGORIZER DEBUG] categorizeProducts is returning ${finalOutput.length} products.`);
        if (finalOutput.length > 0) {
            const firstProductToLog = { ...finalOutput[0] };
            if (!firstProductToLog.hasOwnProperty('additional_categorizations')) {
                // This case should ideally not be hit if the map above works
                firstProductToLog.additional_categorizations = 'FIELD_WAS_MISSING_UNEXPECTEDLY';
            }
            console.log(`[API_CATEGORIZER DEBUG] First product being returned by categorizeProducts:`, JSON.stringify(firstProductToLog, null, 2));
        }
        return finalOutput;
    }

    // Helper method to get all potential keys for correction map lookups
    getPotentialCorrectionMapKeys(product) {
        const keys = [];

        // Add product ID as key (most reliable)
        if (product.productId) {
            keys.push(`productId:${product.productId}`);
            keys.push(product.productId);
        }

        // Add product name (various forms)
        if (product.description) {
            const cleanName = product.description.replace(/[®™©]/g, '');
            keys.push(product.description);
            keys.push(cleanName);
            keys.push(cleanName.toLowerCase());

            // Handle Reser's products specially
            if (cleanName.toLowerCase().includes('reser')) {
                const reserSpecificName = cleanName.toLowerCase().replace(/reser'?s\s+/i, '');
                keys.push(reserSpecificName);
            }
        }

        return keys;
    }

    // Helper method to check if a category/subcategory needs dual mapping
    categoryNeedsDualMapping(category, subcategory) {
        // Check if this category/subcategory appear in dual mappings
        if (this.DUAL_CATEGORY_MAPPINGS[category] &&
            this.DUAL_CATEGORY_MAPPINGS[category][subcategory]) {
            return true;
        }

        // Check if it might be a target of dual categorization
        for (const cat in this.DUAL_CATEGORY_MAPPINGS) {
            for (const sub in this.DUAL_CATEGORY_MAPPINGS[cat]) {
                const mapping = this.DUAL_CATEGORY_MAPPINGS[cat][sub];
                if (mapping.dual_category === category) {
                    return true;
                }
            }
        }

        return false;
    }

    logFailedProducts(products) {
        try {
            const failedFile = path.join(__dirname, 'failed_products.json');
            let failed = [];

            if (fs.existsSync(failedFile)) {
                failed = JSON.parse(fs.readFileSync(failedFile, 'utf8'));
            }

            failed.push(...products);
            fs.writeFileSync(failedFile, JSON.stringify(failed, null, 2));
        } catch (err) {
            console.error('Error logging failed products:', err);
        }
    }

    async processBatchWithRetry(products, maxRetries = 5) {
        let retries = 0;
        let lastError;
        const MAX_BATCH_SIZE = 20;

        // Split if too large
        if (products.length > MAX_BATCH_SIZE) {
            const halfSize = Math.ceil(products.length / 2);
            const batch1 = await this.processBatchWithRetry(products.slice(0, halfSize));
            const batch2 = await this.processBatchWithRetry(products.slice(halfSize));
            return [...batch1, ...batch2];
        }

        while (retries < maxRetries) {
            try {
                return await this.processBatch(products);
            } catch (error) {
                lastError = error;
                retries++;
                // Exponential backoff: 5s, 10s, 20s, 40s, 80s
                const delay = 5000 * Math.pow(2, retries - 1);
                console.log(`Retry ${retries}/${maxRetries} after ${delay / 1000}s delay. Error: ${error.message}`);
                await new Promise(r => setTimeout(r, delay));
            }
        }

        throw new Error(`Failed after ${maxRetries} retries: ${lastError?.message}`);
    }
    async processBatch(products) {
        if (products.length === 0) return [];

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            if (product.images && Array.isArray(product.images)) {
                const frontImage = product.images.find(img => img.perspective === "front");
                if (frontImage && frontImage.sizes) {
                    const largeSize = frontImage.sizes.find(size => size.size === "large");
                    product.image_url = largeSize?.url || null;
                }
            }
        }

        console.log(`Sending to Python wrapper: ${products.length} products, ${products.filter(p => p.image_url).length} with images`);

        try {
            const pythonProcess = spawn(pythonExecutable, [wrapperScriptPath, '--mode', 'categorize']);

            const inputData = {
                products: products,
                taxonomy: this.categoryData
            };
            if (this.currentTaxonomyCacheName) {
                inputData.existing_taxonomy_cache_name = this.currentTaxonomyCacheName;
            }
            if (this.currentTaxonomyCacheName) {
                inputData.existing_taxonomy_cache_name = this.currentTaxonomyCacheName;
            }

            let outputData = '';
            let errorData = '';

            pythonProcess.stdin.write(JSON.stringify(inputData));
            pythonProcess.stdin.end();

            pythonProcess.stdout.on('data', (data) => {
                outputData += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                errorData += data.toString();
                console.error('Python wrapper:', data.toString().trim());
            });

            return new Promise((resolve, reject) => {
                pythonProcess.on('close', (code) => {
                    if (code !== 0) {
                        console.error(`Python process exited with code ${code}: ${errorData}`);
                        try {
                            const errOutput = JSON.parse(outputData || "{}");
                            if (errOutput.taxonomy_cache_name) {
                                this.currentTaxonomyCacheName = errOutput.taxonomy_cache_name;
                                console.log(`Retrieved taxonomy_cache_name on error: ${this.currentTaxonomyCacheName}`);
                            }
                        } catch (parseErr) {
                            // Ignore if output wasn't JSON
                        }
                        reject(new Error(`Python wrapper failed with code ${code}: ${errorData}`));
                        return;
                    }

                    try {
                        const pythonOutput = JSON.parse(outputData);
                        console.log(`[api_categorizer.js] Python output for batch: ${JSON.stringify(pythonOutput)}`);

                        if (pythonOutput.taxonomy_cache_name) {
                            this.currentTaxonomyCacheName = pythonOutput.taxonomy_cache_name;
                            console.log(`Updated taxonomy_cache_name: ${this.currentTaxonomyCacheName}`);
                        }

                        if (pythonOutput.error) {
                            console.error('Python script returned an error:', pythonOutput.error);
                            reject(new Error(pythonOutput.error));
                            return;
                        }

                        const categorizationResults = pythonOutput.categorizations || [];

                        const categorizedProducts = categorizationResults.map((result, i) => {
                            const product = products[i];
                            if (!product) {
                                console.error(`Product at index ${i} is undefined. Results length: ${categorizationResults.length}, Products length: ${products.length}`);
                                this.logFailedCategorization({ description: `Undefined product at index ${i}` }, new Error("Mismatch in product/result length"), result);
                                return {
                                    description: `Error: Product undefined at index ${i}`,
                                    category: "Uncategorized",
                                    subcategory: "Unknown",
                                    product_type: "Unknown"
                                };
                            }
                            try {
                                const validResult = this.validateCategorization(result, product);
                                return {
                                    ...product,
                                    category: validResult.category,
                                    subcategory: validResult.subcategory,
                                    product_type: validResult.product_type
                                };
                            } catch (error) {
                                console.error(`Validation error for product: ${product.description}`, error);
                                this.logFailedCategorization(product, error, result);
                                return {
                                    ...product,
                                    category: "Uncategorized",
                                    subcategory: "Unknown",
                                    product_type: "Unknown"
                                };
                            }
                        });

                        const correctedProducts = categorizedProducts.map((product, i) => {
                            if (products[i]) {
                                return this.autoCorrectCategory(product, products[i]);
                            }
                            return product;
                        });

                        resolve(correctedProducts);
                    } catch (error) {
                        console.error('Error parsing Python output or processing results:', error);
                        console.error('Raw Python output on parse error:', outputData);
                        reject(error);
                    }
                });
            });
        } catch (error) {
            console.error('Error calling Python wrapper:', error);
            throw error;
        }
    }

    autoCorrectCategory(result, product) {
        const { category, subcategory, product_type } = result;

        // Step 1: Check if the category-subcategory combination is valid
        const validCategory = this.isValidSubcategoryInCategory(category, subcategory);

        // Step 2: If the category-subcategory is valid, check if product_type is valid
        if (validCategory) {
            const validProductType = this.isValidProductTypeInSubcategory(category, subcategory, product_type);

            if (validProductType) {
                // Everything is valid, no correction needed
                return result;
            } else {
                // Product type is invalid but category and subcategory are valid
                // Try to find the correct product type within this subcategory
                return this.correctProductType(result, product);
            }
        }

        // Step 3: Category-subcategory pair is invalid, find correct category
        const possibleCategories = this.categoryData.filter(c =>
            c.subcategories.some(s => s.name === subcategory)
        );

        if (possibleCategories.length === 1) {
            const correctedCategory = possibleCategories[0].name;

            // Log the correction
            this.logCategoryCorrection(product, {
                original: { category, subcategory, product_type },
                corrected: { category: correctedCategory, subcategory, product_type },
                alternatives: [correctedCategory],
                confidence: "high",
                reason: "fixed_category_hierarchy"
            });

            // First fix the category, then check if product_type is valid in new location
            const fixedCategoryResult = {
                ...result,
                category: correctedCategory
            };

            // Now check if product_type is valid in the new location
            return this.correctProductType(fixedCategoryResult, product);

        } else if (possibleCategories.length > 1) {
            // Multiple possible categories - ambiguous case
            this.logCategoryCorrection(product, {
                original: { category, subcategory, product_type },
                corrected: null,
                alternatives: possibleCategories.map(c => c.name),
                confidence: "low",
                reason: "multiple_possible_categories"
            });
        } else {
            // Subcategory doesn't exist anywhere in our taxonomy
            this.logCategoryCorrection(product, {
                original: { category, subcategory, product_type },
                corrected: null,
                alternatives: [],
                confidence: "none",
                reason: "subcategory_not_found"
            });
        }

        // If we can't auto-correct, return the original result
        return result;
    }

    correctProductType(result, product) {
        const { category, subcategory, product_type } = result;

        // Check if product_type is valid for this category/subcategory
        if (this.isValidProductTypeInSubcategory(category, subcategory, product_type)) {
            return result;
        }

        // Find available product types for this subcategory
        let availableProductTypes = [];
        for (const cat of this.categoryData) {
            if (cat.name === category) {
                for (const sub of cat.subcategories) {
                    if (sub.name === subcategory) {
                        if (sub.gridOnly) {
                            // For gridOnly subcategories, product_type should be subcategory name
                            this.logCategoryCorrection(product, {
                                original: { category, subcategory, product_type },
                                corrected: { category, subcategory, product_type: subcategory },
                                alternatives: [subcategory],
                                confidence: "high",
                                reason: "fixed_product_type_gridonly"
                            });

                            return {
                                ...result,
                                product_type: subcategory
                            };
                        }

                        availableProductTypes = sub.productTypes || [];
                        break;
                    }
                }
                break;
            }
        }

        // No product types available
        if (availableProductTypes.length === 0) {
            return result;
        }

        // If the product_type isn't valid, use the first available one
        this.logCategoryCorrection(product, {
            original: { category, subcategory, product_type },
            corrected: { category, subcategory, product_type: availableProductTypes[0] },
            alternatives: availableProductTypes,
            confidence: "medium",
            reason: "invalid_product_type"
        });

        return {
            ...result,
            product_type: availableProductTypes[0]
        };
    }

    isValidSubcategoryInCategory(category, subcategory) {
        const categoryObj = this.categoryData.find(c => c.name === category);
        if (!categoryObj) return false;

        return categoryObj.subcategories.some(s => s.name === subcategory);
    }

    isValidProductTypeInSubcategory(category, subcategory, product_type) {
        const categoryObj = this.categoryData.find(c => c.name === category);
        if (!categoryObj) return false;

        const subcategoryObj = categoryObj.subcategories.find(s => s.name === subcategory);
        if (!subcategoryObj) return false;

        // For gridOnly subcategories, product_type should match subcategory name
        if (subcategoryObj.gridOnly) return product_type === subcategory;

        // Check if product_type exists in productTypes array
        return subcategoryObj.productTypes && subcategoryObj.productTypes.includes(product_type);
    }

    validateCategorization(result, product) {
        const category = result.category;
        const subcategory = result.subcategory;
        const productType = result.product_type;

        // Find the category in our taxonomy
        const categoryObj = this.categoryData.find(c => c.name === category);
        if (!categoryObj) {
            console.warn(`Invalid category "${category}" for product "${product.description}".`);
            // Log this as a failure
            this.logFailedCategorization(product, new Error(`Invalid category: ${category}`), result);

            // Use first category from taxonomy
            const firstCategory = this.categoryData[0];
            return {
                category: firstCategory.name,
                subcategory: firstCategory.subcategories[0].name,
                product_type: firstCategory.subcategories[0].productTypes?.[0] || firstCategory.subcategories[0].name
            };
        }

        // Find the subcategory
        const subcategoryObj = categoryObj.subcategories.find(s => s.name === subcategory);
        if (!subcategoryObj) {
            console.warn(`Invalid subcategory "${subcategory}" for product "${product.description}".`);
            // Log this as a failure
            this.logFailedCategorization(product, new Error(`Invalid subcategory: ${subcategory}`), result);

            return {
                category: category,
                subcategory: categoryObj.subcategories[0].name,
                product_type: categoryObj.subcategories[0].productTypes?.[0] || categoryObj.subcategories[0].name
            };
        }

        // For gridOnly subcategories, product_type should match subcategory name
        if (subcategoryObj.gridOnly || !subcategoryObj.productTypes || subcategoryObj.productTypes.length === 0) {
            // Replace "Unknown" with subcategory name for gridOnly
            if (productType === "Unknown") {
                return { category, subcategory, product_type: subcategory };
            }
            return { category, subcategory, product_type: subcategory };
        }

        // Check if product_type is valid
        if (!subcategoryObj.productTypes.includes(productType)) {
            console.warn(`Invalid product_type "${productType}" for "${category}" → "${subcategory}".`);
            // Log this as a failure
            this.logFailedCategorization(product, new Error(`Invalid product_type: ${productType}`), result);

            return {
                category,
                subcategory,
                product_type: subcategoryObj.productTypes[0]
            };
        }

        // All valid
        return { category, subcategory, product_type: productType };
    }

    async applyDualCategorization(products) {
        console.log('🚀 Starting dual categorization process for', products.length, 'products...');

        return new Promise((resolve, reject) => {
            try {
                const validProductsForDual = products.filter(p => p.category && p.subcategory && p.product_type && p.category !== "Uncategorized" && p.category !== "Error");
                const skippedProducts = products.filter(p => !(p.category && p.subcategory && p.product_type && p.category !== "Uncategorized" && p.category !== "Error"));

                if (skippedProducts.length > 0) {
                    console.warn(`Skipping ${skippedProducts.length} products from dual categorization due to missing initial cat fields or being Uncategorized/Error.`);
                }
                if (validProductsForDual.length === 0) {
                    console.log("No valid products for dual categorization after filtering.");
                    resolve(products); // Return original full list of products
                    return;
                }

                const inputJson = JSON.stringify(validProductsForDual);

                console.log(`Sending ${validProductsForDual.length} products to dual_bridge.py`);
                const pythonProcess = spawn(pythonExecutable, [dualBridgeScriptPath]);

                let outputData = '';
                let errorData = '';

                pythonProcess.stdin.write(inputJson);
                pythonProcess.stdin.end();

                pythonProcess.stdout.on('data', (data) => {
                    outputData += data.toString();
                });

                pythonProcess.stderr.on('data', (data) => {
                    errorData += data.toString();
                    console.error('Python dual_bridge stderr:', data.toString().trim());
                });

                pythonProcess.on('close', async (code) => {
                    if (code !== 0) {
                        console.error(`Python dual_bridge process exited with code ${code}: ${errorData}`);
                        validProductsForDual.forEach(p => this.logFailedCategorization(p, new Error(`Dual bridge failed with code ${code}`), { error: 'dual_bridge_failed' }, "applyDualCategorization_close_error"));
                        const finalProducts = [...skippedProducts, ...validProductsForDual.map(p => ({ ...p, additional_categorizations: p.additional_categorizations || [] }))];
                        resolve(finalProducts);
                        return;
                    }
                    try {
                        const productsFromDualBridge = JSON.parse(outputData);
                        console.log(`📦 Received ${productsFromDualBridge.length} products from dual bridge`);

                        const bridgeResultsMap = new Map();
                        productsFromDualBridge.forEach(p => bridgeResultsMap.set(p.productId || p.description, p));

                        const needsLLMForAdditional = [];

                        validProductsForDual.forEach(originalProduct => {
                            const bridgeResult = bridgeResultsMap.get(originalProduct.productId || originalProduct.description);
                            if (bridgeResult && bridgeResult.additional_categorizations) {
                                originalProduct.additional_categorizations = bridgeResult.additional_categorizations;
                                console.log(`[API_CATEGORIZER DEBUG applyDualCategorization] Product "${originalProduct.description}" got additional_categorizations:`, JSON.stringify(originalProduct.additional_categorizations, null, 2));

                                if (originalProduct.additional_categorizations.length > 0) {
                                    let needsLLMThisProduct = false;
                                    for (const cat of originalProduct.additional_categorizations) {
                                        if (!cat.product_type) {
                                            needsLLMThisProduct = true;
                                            break;
                                        }
                                    }
                                    if (needsLLMThisProduct) {
                                        console.log(`🤖 LLM needed for additional cat product_type: ${originalProduct.description}`);
                                        needsLLMForAdditional.push(originalProduct);
                                    } else {
                                        console.log(`✨ Direct mapping found for all additional cat product_types: ${originalProduct.description}`);
                                    }
                                }
                            } else {
                                originalProduct.additional_categorizations = [];
                                console.log(`[API_CATEGORIZER DEBUG applyDualCategorization] Product "${originalProduct.description}" got EMPTY additional_categorizations (no bridgeResult or no additional_cats in bridgeResult).`);
                            }
                        });

                        console.log(`📊 Dual Summary: ${validProductsForDual.length - needsLLMForAdditional.length} products with all additional product_types mapped or no additional cats, ${needsLLMForAdditional.length} products need LLM for some additional product_types`);

                        if (needsLLMForAdditional.length > 0) {
                            await this.batchDetermineProductTypes(needsLLMForAdditional);
                        }

                        console.log(`✅ Dual categorization step complete!`);
                        const finalProductsToResolve = [...skippedProducts, ...validProductsForDual];
                        resolve(finalProductsToResolve);

                    } catch (parseError) {
                        console.error('❌ Error parsing dual_bridge.py output:', parseError.message);
                        console.error('Raw output from dual_bridge.py:', outputData.substring(0, 500) + "...");
                        validProductsForDual.forEach(p => this.logFailedCategorization(p, parseError, { error: 'dual_bridge_parse_error' }, "applyDualCategorization_parse_error"));
                        const finalProducts = [...skippedProducts, ...validProductsForDual.map(p => ({ ...p, additional_categorizations: p.additional_categorizations || [] }))];
                        resolve(finalProducts);
                    }
                });

                pythonProcess.on('error', (err) => {
                    console.error('Failed to start dual_bridge.py process.', err);
                    validProductsForDual.forEach(p => this.logFailedCategorization(p, err, { error: 'dual_bridge_spawn_error' }, "applyDualCategorization_spawn_error"));
                    const finalProducts = [...skippedProducts, ...validProductsForDual.map(p => ({ ...p, additional_categorizations: p.additional_categorizations || [] }))];
                    // Instead of reject, resolve with products to allow main flow to continue if spawn fails
                    resolve(finalProducts);
                });

            } catch (error) {
                console.error('❌ Error setting up dual_bridge.py call:', error);
                products.forEach(p => this.logFailedCategorization(p, error, { error: 'dual_bridge_setup_error' }, "applyDualCategorization_setup_error"));
                resolve(products);
            }
        });
    }

    async batchDetermineProductTypes(products) { // products here are those that have additional_categorizations needing product_type
        console.log(`🔄 Batching product type determination for additional categories for ${products.length} products`);

        const batchItems = [];
        // products is an array of full product objects that need some of their additional_categorizations product_types determined

        products.forEach(product => { // Iterate over the products that were passed in (e.g. from needsLLMForAdditional)
            if (product.additional_categorizations) {
                for (let i = 0; i < product.additional_categorizations.length; i++) {
                    const catEntry = product.additional_categorizations[i];
                    if (!catEntry.product_type) {
                        let availableProductTypes = [];
                        for (const taxCategory of this.categoryData) {
                            if (taxCategory.name === catEntry.main_category) {
                                for (const taxSubcat of taxCategory.subcategories) {
                                    if (taxSubcat.name === catEntry.subcategory) {
                                        if (taxSubcat.gridOnly || !taxSubcat.productTypes || taxSubcat.productTypes.length === 0) {
                                            catEntry.product_type = catEntry.subcategory;
                                            console.log(`Auto-assigned product_type for gridOnly additional cat: ${product.description} -> ${catEntry.main_category}/${catEntry.subcategory}/${catEntry.product_type}`);
                                            break;
                                        }
                                        availableProductTypes = taxSubcat.productTypes;
                                        break;
                                    }
                                }
                                break;
                            }
                        }
                        if (!catEntry.product_type && availableProductTypes.length > 0) {
                            batchItems.push({
                                id: `prod_${product.productId || products.indexOf(product)}_addcat_${i}`,
                                originalProductRef: product,
                                additionalCatIndex: i,
                                description: product.description,
                                category: catEntry.main_category,
                                subcategory: catEntry.subcategory,
                                availableProductTypes: availableProductTypes
                            });
                        } else if (!catEntry.product_type && availableProductTypes.length === 0) {
                            catEntry.product_type = catEntry.subcategory; // Fallback
                            console.warn(`No available product types for additional cat: ${product.description} -> ${catEntry.main_category}/${catEntry.subcategory}. Assigning subcategory name: ${catEntry.product_type}`);
                        }
                    }
                }
            }
        });

        if (batchItems.length === 0) {
            console.log('No items need LLM product type determination for additional categories.');
            return;
        }

        console.log(`Processing ${batchItems.length} additional category entries for product type determination in batches...`);

        const BATCH_SIZE_FOR_PT = 10;
        for (let i = 0; i < batchItems.length; i += BATCH_SIZE_FOR_PT) {
            const chunk = batchItems.slice(i, Math.min(i + BATCH_SIZE_FOR_PT, batchItems.length));
            console.log(`Processing product_type chunk ${Math.floor(i / BATCH_SIZE_FOR_PT) + 1}/${Math.ceil(batchItems.length / BATCH_SIZE_FOR_PT)} (${chunk.length} items)`);

            let success = false;
            let retryCount = 0;
            const maxRetries = 3;

            while (!success && retryCount < maxRetries) {
                try {
                    await this.processBatchChunkForProductTypes(chunk);
                    success = true;
                } catch (error) {
                    retryCount++;
                    console.error(`Failed product_type chunk (Attempt ${retryCount}/${maxRetries}):`, error.message);
                    if (retryCount >= maxRetries) {
                        console.error(`Failed product_type chunk definitively after ${maxRetries} retries.`);
                        for (const item of chunk) {
                            const fallbackType = item.availableProductTypes[0];
                            item.originalProductRef.additional_categorizations[item.additionalCatIndex].product_type = fallbackType;
                            console.warn(`❌ Using fallback product_type for additional cat: ${item.description} -> ${item.category}/${item.subcategory}/${fallbackType}`);
                            this.logFailedCategorization(item.originalProductRef, error, { category: item.category, subcategory: item.subcategory, product_type: "LLM_PT_Failed" }, "batchDetermineProductTypes_fallback");
                        }
                        break;
                    }
                    const delay = 3000 * Math.pow(2, retryCount - 1);
                    console.log(`Retry product_type chunk ${retryCount}/${maxRetries} after ${delay / 1000}s delay`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
            if (i + BATCH_SIZE_FOR_PT < batchItems.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }

    async processBatchChunkForProductTypes(chunk) { // chunk contains items with { originalProductRef, additionalCatIndex, ... }
        const pythonProcess = spawn(pythonExecutable, [wrapperScriptPath, '--mode', 'product_types']);
        let outputData = '';
        let errorData = '';

        const chunkForPython = chunk.map(item => ({
            id: item.id,
            description: item.description,
            category: item.category,
            subcategory: item.subcategory,
            availableProductTypes: item.availableProductTypes
        }));

        pythonProcess.stdin.write(JSON.stringify(chunkForPython));
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => { outputData += data.toString(); });
        pythonProcess.stderr.on('data', (data) => {
            errorData += data.toString();
            console.error('Python wrapper (Product Types) stderr:', data.toString().trim());
        });

        return new Promise((resolve, reject) => {
            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Python wrapper (Product Types) process exited with code ${code}: ${errorData}`);
                    reject(new Error(`Python wrapper (Product Types) failed with code ${code}: ${errorData}`));
                    return;
                }
                try {
                    const resultsFromPython = JSON.parse(outputData);
                    const responseMap = new Map();
                    for (const response of resultsFromPython) {
                        if (response.id) responseMap.set(response.id, response);
                    }

                    for (const item of chunk) {
                        const pythonResponse = responseMap.get(item.id);
                        const targetAdditionalCatEntry = item.originalProductRef.additional_categorizations[item.additionalCatIndex];

                        if (pythonResponse && pythonResponse.product_type && item.availableProductTypes.includes(pythonResponse.product_type)) {
                            targetAdditionalCatEntry.product_type = pythonResponse.product_type;
                            console.log(`✅ Set additional_cat product_type for ${item.description} -> ${item.category}/${item.subcategory}: ${pythonResponse.product_type}`);
                        } else {
                            const fallbackType = item.availableProductTypes[0];
                            targetAdditionalCatEntry.product_type = fallbackType;
                            console.warn(`⚠️ Invalid/missing LLM response for additional_cat product_type: ${item.description} -> ${item.category}/${item.subcategory}. Using fallback: ${fallbackType}`);
                            this.logFailedCategorization(item.originalProductRef, new Error("Invalid LLM product_type response"), { category: item.category, subcategory: item.subcategory, attempted_pt: pythonResponse?.product_type }, "processBatchChunkForProductTypes_fallback");
                        }
                    }
                    resolve();
                } catch (error) {
                    console.error('Error parsing Python (Product Types) output:', error.message);
                    console.error('Raw output from Python (Product Types):', outputData.substring(0, 500) + "...");
                    reject(error);
                }
            });
            pythonProcess.on('error', (err) => {
                console.error('Failed to start Python wrapper (Product Types) process.', err);
                reject(err);
            });
        });
    }

    async determineProductType(productText, category, subcategory) {
        console.log(`🔍 determineProductType called for: ${productText} in ${category} > ${subcategory}`);

        // Get available product types
        let availableProductTypes = [];
        for (const cat of this.categoryData) {
            if (cat.name === category) {
                for (const subcat of cat.subcategories) {
                    if (subcat.name === subcategory) {
                        if (subcat.gridOnly || !subcat.productTypes || subcat.productTypes.length === 0) {
                            return subcategory;
                        }
                        availableProductTypes = subcat.productTypes;
                        break;
                    }
                }
                break;
            }
        }

        if (availableProductTypes.length === 0) {
            return subcategory;
        }

        try {
            const pythonProcess = spawn(pythonExecutable, [wrapperScriptPath, '--mode', 'product_types']);


            // Prepare single item batch
            const batchItem = [{
                id: "single_product",
                description: productText,
                category: category,
                subcategory: subcategory,
                availableProductTypes: availableProductTypes
            }];

            let outputData = '';
            let errorData = '';

            pythonProcess.stdin.write(JSON.stringify(batchItem));
            pythonProcess.stdin.end();

            pythonProcess.stdout.on('data', (data) => {
                outputData += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                errorData += data.toString();
                console.error('Python wrapper:', data.toString());
            });

            return new Promise((resolve, reject) => {
                pythonProcess.on('close', (code) => {
                    if (code !== 0) {
                        console.error(`Python process exited with code ${code}: ${errorData}`);
                        // Return first available type as fallback
                        resolve(availableProductTypes[0]);
                        return;
                    }

                    try {
                        // Parse the result - should be clean JSON
                        const result = JSON.parse(outputData);

                        if (result.length > 0 && result[0].product_type && availableProductTypes.includes(result[0].product_type)) {
                            resolve(result[0].product_type);
                        } else {
                            // Return first available type as fallback
                            resolve(availableProductTypes[0]);
                        }
                    } catch (error) {
                        console.error('Error parsing Python output:', error);
                        // Return first available type as fallback
                        resolve(availableProductTypes[0]);
                    }
                });
            });
        } catch (error) {
            console.error(`Error in product type selection: ${error}`);
            // Return first available type as fallback
            return availableProductTypes[0];
        }
    }
}

module.exports = ProductCategorizer;
