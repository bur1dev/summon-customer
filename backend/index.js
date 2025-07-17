// backend/index.js
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Corrected imports for stream-json
import StreamJsonDefault from 'stream-json'; // Import the default for the main package
const { parser } = StreamJsonDefault;      // Destructure 'parser' from the default

import StreamArrayDefault from 'stream-json/streamers/StreamArray.js';
const { streamArray } = StreamArrayDefault; // This import was likely fine once .js was added

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '.env'); // MODIFIED: Assuming .env is in the same directory as index.js
console.log(`[DOTENV_DEBUG] Attempting to load .env file from: ${envPath}`);
console.log(`[DOTENV_DEBUG] Does .env file exist at that path? ${fs.existsSync(envPath)}`); // Use fs.existsSync

const dotenvResult = dotenv.config({ path: envPath, debug: true }); // Enable dotenv debug

if (dotenvResult.error) {
  console.error('[DOTENV_DEBUG] Error loading .env file:', dotenvResult.error);
} else {
  console.log('[DOTENV_DEBUG] .env file loaded successfully (or no error reported).');
  if (dotenvResult.parsed) {
    console.log('[DOTENV_DEBUG] Parsed variables by dotenv:');
    for (const key in dotenvResult.parsed) {
      // Log keys and only a portion of long values for security/brevity
      const value = dotenvResult.parsed[key];
      const valueToLog = value.length > 20 ? `${value.substring(0, 4)}... (length: ${value.length})` : value;
      console.log(`  ${key}: ${valueToLog}`);
    }
  } else {
    console.log('[DOTENV_DEBUG] dotenv.parsed is undefined, no variables parsed by dotenv itself (might be empty .env or only OS env vars used).');
  }
}

console.log(`[DOTENV_DEBUG] Value of process.env.GEMINI_API_KEY immediately after dotenv.config: ${process.env.GEMINI_API_KEY ? 'Exists (first 4: ' + process.env.GEMINI_API_KEY.substring(0, 4) + '...)' : 'UNDEFINED'}`);
console.log(`[DOTENV_DEBUG] Value of process.env.KROGER_CLIENT_ID immediately after dotenv.config: ${process.env.KROGER_CLIENT_ID ? 'Exists' : 'UNDEFINED'}`);


const MODULE_GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!MODULE_GEMINI_API_KEY) {
  console.error("CRITICAL ERROR: GEMINI_API_KEY is not loaded into MODULE_GEMINI_API_KEY at server startup!");
} else {
  console.log(`[SERVER STARTUP] GEMINI_API_KEY loaded into MODULE_GEMINI_API_KEY: Yes, first 10: ${MODULE_GEMINI_API_KEY.substring(0, 10)}...`);
}

// Now, the rest of your imports and application code
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
// fs is already imported above
// path is already imported above
// fileURLToPath is already imported above
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url); // require can be defined after its constituent parts are imported
const ProductCategorizer = require('../product-categorization/api_categorizer.js');

async function runSortScript() {
  return new Promise((resolve, reject) => {
    const scriptPath = 'sort_products.py';
    // Correctly determine the CWD for the script
    const scriptCwd = path.join(__dirname, '../product-categorization/');
    const absoluteScriptPath = path.join(scriptCwd, scriptPath);

    console.log(`[SortRunner] Attempting to run: python3 ${absoluteScriptPath} from ${scriptCwd}`);

    const pythonProcess = spawn('python3', [scriptPath], { // scriptPath is relative to cwd
      cwd: scriptCwd,
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      const logMsg = `[SortRunner STDOUT] ${data.toString().trim()}`;
      console.log(logMsg);
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      const logMsg = `[SortRunner STDERR] ${data.toString().trim()}`;
      console.error(logMsg);
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`[SortRunner] ${scriptPath} completed successfully.`);
        resolve(stdout);
      } else {
        const errorMessage = `[SortRunner] ${scriptPath} exited with code ${code}. Stderr: ${stderr}`;
        console.error(errorMessage);
        reject(new Error(errorMessage));
      }
    });

    pythonProcess.on('error', (err) => {
      const errorMessage = `[SortRunner] Failed to start ${scriptPath}: ${err.message}`;
      console.error(errorMessage, err);
      reject(new Error(errorMessage));
    });
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Ensure necessary JSON files exist and are valid
function ensureJsonFilesExist() {
  const correctionMapPath = path.join(__dirname, '../product-categorization/correction_map.json');
  const dualCategoryMappingsPath = path.join(__dirname, '../product-categorization/dual_category_mappings.json');

  const files = [
    correctionMapPath,
    dualCategoryMappingsPath
  ];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '{}');
      console.log(`Created empty JSON file: ${filePath}`);
    } else {
      try {
        JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        console.log(`Invalid JSON in ${filePath}, resetting to empty object`);
        fs.writeFileSync(filePath, '{}');
      }
    }
  }
}

// Call this function at server startup
ensureJsonFilesExist();

// Helper function for stock status normalization
function normalizeStockStatus(status) {
  if (!status) return "UNKNOWN";
  const normalized = String(status).toUpperCase();
  if (normalized === "HIGH" || normalized === "IN_STOCK") return "HIGH";
  if (normalized === "LOW" || normalized === "LIMITED") return "LOW";
  return "UNKNOWN";
}

function normalizePromoPrice(promoPrice, regularPrice) {
  if (promoPrice === null || promoPrice === undefined || promoPrice === 0 ||
    typeof promoPrice !== 'number' || isNaN(promoPrice) ||
    typeof regularPrice !== 'number' || promoPrice >= regularPrice) {
    return null;
  }
  return promoPrice;
}

// Root Route
app.get('/', (req, res) => {
  res.send('🎉 Welcome! The backend server is running successfully.');
});

// In-memory token storage
let accessToken = null;
let tokenExpiresAt = null;

/**
 * Fetches an access token from Kroger API using client credentials.
 */
async function getAccessToken() {
  const now = Date.now();

  if (accessToken && tokenExpiresAt && now < tokenExpiresAt) {
    return accessToken;
  }
  console.log("[AUTH] Fetching new access token...");

  // Debug environment variables
  console.log("[DEBUG] ENV vars loaded:", {
    client_id: process.env.KROGER_CLIENT_ID || "MISSING",
    secret_length: process.env.KROGER_CLIENT_SECRET ? process.env.KROGER_CLIENT_SECRET.length : 0,
    secret_starts_with: process.env.KROGER_CLIENT_SECRET ? process.env.KROGER_CLIENT_SECRET.substr(0, 4) : "MISSING"
  });

  // Create Basic Auth header
  const credentials = Buffer.from(`${process.env.KROGER_CLIENT_ID}:${process.env.KROGER_CLIENT_SECRET}`).toString('base64');
  console.log("[DEBUG] Basic auth:", `Basic ${credentials.substr(0, 10)}...`);

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'product.compact'
  });
  console.log("[DEBUG] Request params:", params.toString());

  try {
    const response = await fetch('https://api.kroger.com/v1/connect/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AUTH ERROR] Token request failed with status ${response.status}: ${errorText}`);
      throw new Error(`Token request failed with status ${response.status}`);
    }

    const data = await response.json();
    accessToken = data.access_token;
    tokenExpiresAt = now + (data.expires_in - 60) * 1000;

    console.log('[AUTH] Access token acquired successfully.');
    return accessToken;
  } catch (error) {
    console.error('[AUTH ERROR] Error fetching access token:', error.message);
    throw error;
  }
}

/**
 * Endpoint to fetch locations (stores).
 * Example: GET http://localhost:3000/api/locations?zipCode=92024&chain=Ralphs&limit=5
 */
app.get('/api/locations', async (req, res) => {
  const { zipCode, chain, limit } = req.query;

  if (!zipCode || !chain) {
    return res.status(400).json({ error: 'Missing required query parameters: zipCode, chain' });
  }

  try {
    const token = await getAccessToken();

    const params = new URLSearchParams({
      'filter.zipCode.near': zipCode,
      'filter.chain': chain,
      'filter.limit': limit || '5',
    });

    const response = await fetch(`https://api.kroger.com/v1/locations?${params.toString()}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Location request failed with status ${response.status}: ${errorText}`);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    return res.json(data.data); // Send the array of locations to the frontend
  } catch (error) {
    console.error('Error fetching locations:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/products', async (req, res) => {
  const { searchTerm, locationId, limit } = req.query;

  if (!searchTerm || !locationId) {
    return res.status(400).json({ error: 'Missing required query parameters: searchTerm, locationId' });
  }

  try {
    const token = await getAccessToken();

    const params = new URLSearchParams({
      'filter.term': searchTerm,
      'filter.locationId': locationId,
      'filter.limit': limit || '50',
    });

    const response = await fetch(`https://api.kroger.com/v1/products?${params.toString()}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Product request failed with status ${response.status}: ${errorText}`);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    return res.json(data.data); // Send the array of products to the frontend
  } catch (error) {
    console.error('Error fetching products:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Backend server is running on port ${PORT}`);
});

app.get('/api/all-products', async (req, res) => {
  const { locationId } = req.query;
  const allProducts = [];
  // Comprehensive list of search terms for testing Kroger/Ralphs product search in Holochain DHT
  const searchTerms = [
    'Its Delish Dill Weed', 'sprite', 'Alexandre Eco Dairy Certified Regenerative Organic Whole Milk'
  ];
  try {
    console.log(`Fetching all products for location: ${locationId}`);

    for (const term of searchTerms) {
      let start = 0;
      const limit = 50;

      while (start <= 300) { // Kroger API limit
        const token = await getAccessToken();
        const params = new URLSearchParams({
          'filter.locationId': locationId,
          'filter.limit': limit.toString(),
          'filter.start': start.toString(),
          'filter.term': term,
          'filter.fulfillment': 'ais' // Available In Store
        });

        console.log(`Making request with params:`, params.toString());

        const response = await fetch(`https://api.kroger.com/v1/products?${params.toString()}`, {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          console.error(`Response not OK for term "${term}":`, await response.text());
          break;
        }

        const data = await response.json();

        if (!data.data?.length) {
          console.log(`No more products found for term "${term}"`);
          break;
        }

        const newProducts = data.data.filter(product => {
          const hasPrice = (product.items?.[0]?.price?.regular || 0) > 0;
          const isNew = !allProducts.some(p => p.productId === product.productId);
          return hasPrice && isNew;
        });

        allProducts.push(...newProducts);
        console.log(`Got ${newProducts.length} new products for "${term}" (start=${start}). Total: ${allProducts.length}`);

        start += limit;
        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
      }
    }

    console.log(`Returning ${allProducts.length} total unique products`);
    return res.json(allProducts);

  } catch (error) {
    console.error('Detailed error:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/categorize', async (req, res) => {
  const { products, taxonomy_cache_name_from_client } = req.body;
  if (!products || !Array.isArray(products)) {
    return res.status(400).json({ error: "Request body must include a 'products' array." });
  }
  console.log("Categorize endpoint hit with", products.length, "products");
  if (taxonomy_cache_name_from_client) {
    console.log("➡️ Received taxonomy_cache_name_from_client:", taxonomy_cache_name_from_client);
  } else {
    console.log("➡️ No taxonomy_cache_name_from_client received (expected for first batch).");
  }

  try {
    console.log("API Key loaded:", process.env.GEMINI_API_KEY ?
      `Yes (${process.env.GEMINI_API_KEY.substring(0, 10)}...)` : "No");

    console.log(`[DEBUG /api/process-recat-queue] GEMINI_API_KEY available here? ${process.env.GEMINI_API_KEY ? 'Yes, first 10: ' + process.env.GEMINI_API_KEY.substring(0, 10) + '...' : 'No, it is undefined!'}`);
    console.log(`[DEBUG /api/process-recat-queue] MODULE_GEMINI_API_KEY available here? ${MODULE_GEMINI_API_KEY ? 'Yes, first 10: ' + MODULE_GEMINI_API_KEY.substring(0, 10) + '...' : 'No, MODULE_GEMINI_API_KEY is undefined!'}`);
    const categorizer = new ProductCategorizer(MODULE_GEMINI_API_KEY);

    if (taxonomy_cache_name_from_client) {
      categorizer.currentTaxonomyCacheName = taxonomy_cache_name_from_client;
      console.log(`🔧 Set categorizer.currentTaxonomyCacheName to: ${categorizer.currentTaxonomyCacheName}`);
    }

    // The `categorizeProducts` method in api_categorizer.js internally calls processBatch,
    // which uses `this.currentTaxonomyCacheName`.
    // The result of `categorizeProducts` is just the array of categorized products.
    // The updated `this.currentTaxonomyCacheName` (if a new cache was made or an old one confirmed)
    // is stored on the `categorizer` instance.
    const categorizedProductList = await categorizer.categorizeProducts(products);

    if (categorizedProductList && categorizedProductList.length > 0) {
      console.log("[index.js /api/categorize] First product from categorizedProductList (before transform):", JSON.stringify(categorizedProductList[0]));
    }

    const transformedProducts = categorizedProductList.map((product, index) => { // Added index for logging
      const nestedProductObject = {
        productId: product.productId,
        name: product.description,
        price: product.items?.[0]?.price?.regular || 0,
        promo_price: (product.items?.[0]?.price?.promo &&
          product.items?.[0]?.price?.promo !== 0 &&
          product.items?.[0]?.price?.promo < product.items?.[0]?.price?.regular) ?
          product.items?.[0]?.price?.promo : null,
        size: product.items?.[0]?.size || "",
        stocks_status: normalizeStockStatus(product.items?.[0]?.inventory?.stockLevel),
        category: product.category,
        subcategory: product.subcategory || null,
        product_type: product.product_type || null,
        image_url: product.image_url || null,
        sold_by: product.items?.[0]?.soldBy || null,
        brand: product.brand || null,
        is_organic: typeof product.is_organic === 'boolean' ? product.is_organic : false
      };

      // ADD THIS LOG
      if (index === 0) { // Log only for the first product
        console.log(`[index.js /api/categorize MAP] product.productId for first item (source): ${product.productId}`);
        console.log(`[index.js /api/categorize MAP] typeof product.productId for first item (source): ${typeof product.productId}`);
        console.log(`[index.js /api/categorize MAP] NESTED product.productId for first item (target): ${nestedProductObject.productId}`);
      }
      // END ADDED LOG

      return {
        product: nestedProductObject, // Assign the created nested object
        main_category: product.category,
        subcategory: product.subcategory || null,
        product_type: product.product_type || null,
        additional_categorizations: product.additional_categorizations || []
      };
    });

    // Save categorized products (This logic seems to assume categorizedProductList has productIds, ensure it does)
    const categorizedDataPath = path.join(__dirname, '../product-categorization/categorized_products.json');
    let allCategorized = [];

    if (fs.existsSync(categorizedDataPath)) {
      try {
        const existingDataFileContent = fs.readFileSync(categorizedDataPath, 'utf8');
        const existingData = existingDataFileContent ? JSON.parse(existingDataFileContent) : [];

        const existingProductIds = new Set(existingData.map(p => p.productId));
        const newProducts = categorizedProductList.filter(p => !p.productId || !existingProductIds.has(p.productId));
        allCategorized = existingData.concat(newProducts);
      } catch (error) {
        console.error('Error reading or parsing existing categorized_products.json:', error);
        // If file is corrupt or empty, start fresh with current batch
        allCategorized = categorizedProductList;
      }
    } else {
      allCategorized = categorizedProductList;
    }

    fs.writeFileSync(categorizedDataPath, JSON.stringify(allCategorized, null, 2)); // Added null, 2 for pretty print

    // Run the sort script
    const { spawn } = require('child_process'); // Already required above, but ensure it's accessible
    try {
      await runSortScript();
    } catch (sortError) {
      console.error('Error running sort_products.py after /api/categorize:', sortError.message);
      // Decide if you want to let the main response succeed or also indicate sort failure.
      // For now, we log the error and let the main API response proceed.
    }

    // Respond with an object that includes the products and the updated cache name
    console.log(`⬅️ Responding with taxonomy_cache_name: ${categorizer.currentTaxonomyCacheName}`);
    res.json({
      categorizedProducts: transformedProducts,
      taxonomy_cache_name: categorizer.currentTaxonomyCacheName
    });

  } catch (error) {
    console.error('Categorization error:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW - Report category with full suggestion
app.post('/api/report-category', (req, res) => {
  try {
    const reportData = req.body;

    // Add server timestamp and source indicator
    reportData.server_timestamp = new Date().toISOString();
    reportData.source = 'user';
    reportData.status = 'pending';
    reportData.type = 'suggestion'; // This is a suggestion-type report

    // Append to the report file
    const reportFile = path.join(__dirname, '../product-categorization/reported_categorizations.jsonl');

    fs.appendFileSync(
      reportFile,
      JSON.stringify(reportData) + '\n'
    );

    console.log('Category report with suggestion received:', reportData);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error saving category report:', error);
    return res.status(500).json({ error: 'Failed to save category report' });
  }
});

// NEW - Report simple feedback (just flagging)
app.post('/api/report-incorrect-category', (req, res) => {
  try {
    const { product, currentCategory } = req.body;

    const reportData = {
      product: product,
      currentCategory: currentCategory,
      timestamp: new Date().toISOString(),
      server_timestamp: new Date().toISOString(),
      type: "negative_example",
      source: "user",
      status: "pending"
    };

    const reportFile = path.join(__dirname, '../product-categorization/reported_categorizations.jsonl');
    fs.appendFileSync(reportFile, JSON.stringify(reportData) + '\n');
    console.log('Incorrect category report received:', reportData);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error saving incorrect category report:', error);
    return res.status(500).json({ error: 'Failed to save report' });
  }
});

// Get all category reports
app.get('/api/category-reports', (req, res) => {
  try {
    const reportFile = path.join(__dirname, '../product-categorization/reported_categorizations.jsonl');

    // Check if file exists
    if (!fs.existsSync(reportFile)) {
      return res.json([]);
    }

    // Read and parse the file
    const content = fs.readFileSync(reportFile, 'utf8');
    if (!content.trim()) {
      return res.json([]);
    }

    const lines = content.trim().split('\n');

    const reports = lines.map((line, index) => {
      const report = JSON.parse(line);
      // Add ID for easy reference
      return { id: index, ...report };
    });

    return res.json(reports);
  } catch (error) {
    console.error('Error reading reports:', error);
    return res.status(500).json({ error: 'Failed to read category reports' });
  }
});

app.post('/api/queue-for-recategorization', (req, res) => {
  try {
    const { reportId } = req.body;

    // Get the report
    const reportFile = path.join(__dirname, '../product-categorization/reported_categorizations.jsonl');
    if (!fs.existsSync(reportFile)) {
      console.error('[QUEUEING] Reports file not found:', reportFile);
      return res.status(404).json({ error: 'Reports file not found' });
    }

    const content = fs.readFileSync(reportFile, 'utf8');
    if (!content.trim()) {
      console.error('[QUEUEING] Reports file is empty.');
      return res.status(404).json({ error: 'Reports file is empty, cannot find report.' });
    }
    const lines = content.trim().split('\n');

    const index = parseInt(reportId, 10);
    if (isNaN(index) || index < 0 || index >= lines.length) {
      console.error(`[QUEUEING] Report with ID ${reportId} not found. Index out of bounds or NaN.`);
      return res.status(404).json({ error: `Report with ID ${reportId} not found` });
    }

    let report;
    try {
      report = JSON.parse(lines[index]);
    } catch (parseError) {
      console.error(`[QUEUEING] Error parsing report line ${index} from reports file:`, parseError);
      return res.status(500).json({ error: `Could not parse report ID ${reportId}. File might be corrupted.` });
    }


    if (!report || !report.product) {
      console.error(`[QUEUEING] Report ID ${reportId} is missing product data. Report content:`, JSON.stringify(report));
      return res.status(400).json({ error: `Report ID ${reportId} is invalid or missing product information.` });
    }

    // Update the report status in reported_categorizations.jsonl
    report.status = 'queued_for_recategorization';
    report.queued_at = new Date().toISOString();
    lines[index] = JSON.stringify(report); // Update the specific line
    try {
      fs.writeFileSync(reportFile, lines.join('\n') + (lines.length > 0 ? '\n' : '')); // Ensure newline if content exists
      console.log(`[QUEUEING] Updated status for report ID ${reportId} to 'queued_for_recategorization'.`);
    } catch (writeError) {
      console.error(`[QUEUEING] Error writing updated reports file:`, writeError);
      // Continue, as the main goal is to queue the product, but log this issue.
    }


    // Add product to recategorization queue (products_to_recategorize.json)
    const queueFile = path.join(__dirname, '../product-categorization/products_to_recategorize.json');
    let queuedProducts = [];

    if (fs.existsSync(queueFile)) {
      try {
        const queueFileContent = fs.readFileSync(queueFile, 'utf8');
        if (queueFileContent.trim()) { // Only parse if not empty
          const parsedQueue = JSON.parse(queueFileContent);
          if (Array.isArray(parsedQueue)) {
            queuedProducts = parsedQueue;
          } else {
            console.warn('[QUEUEING] Existing queue file content is not an array. Initializing as empty array.');
            // Optionally, backup the corrupted file before overwriting
            // fs.copyFileSync(queueFile, `${queueFile}.corrupted.${Date.now()}`);
            // fs.writeFileSync(queueFile, JSON.stringify([])); // Reset to valid empty array
          }
        }
      } catch (err) {
        console.error('[QUEUEING] Error reading or parsing existing recategorization queue file. Initializing as empty array. Error:', err);
        // queuedProducts remains [], which is fine.
        // Optionally, backup and reset as above.
      }
    }

    // Robustly get identifiers from the report's product object
    const productId = report.product.productId; // Might be undefined
    const productName = report.product.name || report.product.description; // Prioritize name, fallback to description
    const productDescription = report.product.description || report.product.name; // Prioritize description, fallback to name

    // Ensure we have at least some identifier to avoid pushing completely blank products
    if (!productId && !productName) {
      console.error(`[QUEUEING] CRITICAL: Report ID ${reportId} product has no productId AND no name/description. Cannot queue effectively. Product in report:`, JSON.stringify(report.product));
      return res.status(400).json({ error: 'Reported product is missing essential identifiers (productId or name/description). Cannot add to queue.' });
    }

    // Check if already queued (more robustly)
    const isAlreadyQueued = queuedProducts.some(p =>
      (productId && p.productId === productId) || // Primary match: by productId if both have it
      (!productId && !p.productId && p.description === productDescription && p.name === productName) // Fallback: if both lack productId, match on name AND description
    );

    let message;
    if (!isAlreadyQueued) {
      // Construct the product object to be added to the queue
      const productToQueue = {
        ...report.product, // Spread all fields from the report's product object first
        // Explicitly set/override key fields to ensure they are present and correctly sourced
        productId: productId,        // Will be undefined if original was undefined, but field is present
        name: productName,           // Ensures 'name' field is populated
        description: productDescription, // Ensures 'description' field is populated
        report_id: reportId,         // Link back to the original report
        report_type: report.type,
        force_llm: report.type === "negative_example", // Add force_llm flag for negative examples
        queued_at: report.queued_at    // Timestamp when it was officially queued
      };

      console.log('[QUEUEING] productToQueue object being added to queue file:', JSON.stringify(productToQueue, null, 2));

      queuedProducts.push(productToQueue); // Add the new product

      try {
        fs.writeFileSync(queueFile, JSON.stringify(queuedProducts, null, 2)); // Save the updated array
        message = `Product (ID: ${productId || 'N/A'}, Name: "${productName || 'N/A'}") added to recategorization queue.`;
        console.log(`[QUEUEING] ${message}`);
      } catch (writeError) {
        console.error(`[QUEUEING] Error writing updated queue file:`, writeError);
        return res.status(500).json({ error: 'Failed to write to recategorization queue file.' });
      }
    } else {
      message = `Product (ID: ${productId || 'N/A'}, Name: "${productName || 'N/A'}") already in recategorization queue.`;
      console.log(`[QUEUEING] ${message}`);
    }

    return res.json({
      success: true,
      message: message
    });

  } catch (error) {
    console.error('[QUEUEING] Overall error in /api/queue-for-recategorization:', error);
    return res.status(500).json({ error: `Error queueing product for recategorization: ${error.message}` });
  }
});

// NEW - Process recategorization queue
app.post('/api/process-recategorization-queue', async (req, res) => {
  try {
    // Load products to recategorize
    const queuePath = path.join(__dirname, '../product-categorization/products_to_recategorize.json');
    if (!fs.existsSync(queuePath)) {
      console.log('[INDEX.JS /api/process-recat-queue] No queue file exists.');
      return res.json({ success: true, processed: 0, message: 'No queue file exists' });
    }

    const queueContent = fs.readFileSync(queuePath, 'utf8');
    console.log('[INDEX.JS /api/process-recat-queue] Queue content length:', queueContent.length); // Existing log, good for seeing byte size
    console.log('[INDEX.JS /api/process-recat-queue] RAW QUEUE FILE CONTENT:\n---\n', queueContent, '\n---'); // THE ONE NEW LOG TO SHOW RAW CONTENT

    let productsInQueue = []; // Initialize as an empty array
    if (queueContent.trim()) { // Only try to parse if there's actual content
      try {
        const parsedData = JSON.parse(queueContent);
        if (Array.isArray(parsedData)) {
          productsInQueue = parsedData;
        } else {
          console.error('[INDEX.JS /api/process-recat-queue] ERROR: Parsed queue content is NOT an array. Content starts with:', queueContent.substring(0, 100));
          // productsInQueue remains empty, or you could choose to reset the file:
          // fs.writeFileSync(queuePath, JSON.stringify([]));
        }
      } catch (e) {
        console.error('[INDEX.JS /api/process-recat-queue] ERROR parsing queue file JSON:', e.message);
        console.error('[INDEX.JS /api/process-recat-queue] Malformed content starts with:', queueContent.substring(0, 100));
        // productsInQueue remains empty, or you could choose to reset the file:
        // fs.writeFileSync(queuePath, JSON.stringify([]));
      }
    }// Renamed to avoid conflict

    if (productsInQueue.length === 0) {
      console.log('[INDEX.JS /api/process-recat-queue] Queue is empty.');
      return res.json({ success: true, processed: 0, message: 'Queue is empty' });
    }

    console.log(`Processing ${productsInQueue.length} products in recategorization queue`);

    const correctionMapPath = path.join(__dirname, '../product-categorization/correction_map.json');
    let correctionMap = {};
    if (fs.existsSync(correctionMapPath)) {
      correctionMap = JSON.parse(fs.readFileSync(correctionMapPath, 'utf8'));
    }

    // Temporarily remove products being recategorized from correction map if not force_llm
    const tempCorrectionMap = { ...correctionMap }; // Work with a copy
    productsInQueue.forEach(productInQ => {
      const productKeyByName = productInQ.name ? productInQ.name.toLowerCase() : null;
      const productKeyById = productInQ.productId ? `productId:${productInQ.productId}` : null;

      if (!productInQ.force_llm) { // Only remove if not forcing LLM (as force_llm bypasses map anyway)
        if (productKeyByName && tempCorrectionMap[productKeyByName]) {
          // We don't actually remove it here if we want correction map to drive the change.
          // The original logic was to remove it so LLM would be forced.
          // For a user-driven correction that updated the map, we WANT the map to be used.
          // So, the "temporary removal" logic might be re-thought or only applied for specific scenarios.
          // For now, let's assume if force_llm is false, we *want* to use the map if an entry exists.
          // The categorizer itself will check the map.
          console.log(`Product ${productInQ.name} will be processed; correction map will be consulted by categorizer.`);
        }
        if (productKeyById && tempCorrectionMap[productKeyById]) {
          console.log(`Product ID ${productInQ.productId} will be processed; correction map will be consulted by categorizer.`);
        }
      } else {
        console.log(`Product ${productInQ.name || productInQ.productId} has force_llm=true, will bypass correction map.`);
      }
    });
    // No need to write tempCorrectionMap back unless we were actually modifying it for this run.

    console.log(`[DEBUG /api/process-recat-queue] GEMINI_API_KEY available here? ${process.env.GEMINI_API_KEY ? 'Yes, first 10: ' + process.env.GEMINI_API_KEY.substring(0, 10) + '...' : 'No, it is undefined!'}`);
    console.log(`[DEBUG /api/process-recat-queue] MODULE_GEMINI_API_KEY available here? ${MODULE_GEMINI_API_KEY ? 'Yes, first 10: ' + MODULE_GEMINI_API_KEY.substring(0, 10) + '...' : 'No, MODULE_GEMINI_API_KEY is undefined!'}`);
    const categorizer = new ProductCategorizer(MODULE_GEMINI_API_KEY);
    console.log(`Processing ${productsInQueue.length} products through LLM and dual categorization pipeline`);

    const productsForCategorizer = productsInQueue.map(p => ({
      description: p.name || p.description, // Ensure description is present
      productId: p.productId,
      items: [{ price: { regular: p.price || 0 }, promo: { regular: p.promo_price || 0 } }], // Mimic Kroger structure
      image_url: p.image_url,
      // Pass the force_llm flag to the categorizer if it can use it,
      // otherwise, the categorizer's internal logic for correction map will apply.
      force_llm: p.force_llm
    }));

    let categorizedResults = [];
    try {
      categorizedResults = await categorizer.categorizeProducts(productsForCategorizer);
      console.log(`Successfully categorized ${categorizedResults.length} products via API categorizer.`);
    } catch (error) {
      console.error('Error in API categorization during queue processing:', error);
      return res.status(500).json({ error: `API categorization failed: ${error.message}` });
    }

    const categorizedDataPath = path.join(__dirname, '../product-categorization/categorized_products.json');
    let allCategorizedProducts = []; // Renamed to avoid conflict

    if (fs.existsSync(categorizedDataPath)) {
      try {
        allCategorizedProducts = JSON.parse(fs.readFileSync(categorizedDataPath, 'utf8'));
      } catch (err) {
        console.error("Error reading categorized_products.json, starting with empty list for updates:", err);
        allCategorizedProducts = []; // Start fresh if file is corrupt
      }
    }

    for (const recategorizedProduct of categorizedResults) {
      const productId = recategorizedProduct.productId;
      const description = recategorizedProduct.description; // Name from categorizer output

      let existingIndex = -1;
      if (productId) {
        existingIndex = allCategorizedProducts.findIndex(p => p.productId === productId);
      }
      if (existingIndex === -1 && description) {
        existingIndex = allCategorizedProducts.findIndex(p => (p.description === description || p.name === description));
      }

      if (existingIndex !== -1) {
        const originalProduct = allCategorizedProducts[existingIndex];
        console.log('[DEBUG /api/process-recategorization-queue] Original Product from allCategorized:', JSON.stringify(originalProduct, null, 2));
        console.log('[DEBUG /api/process-recategorization-queue] Recategorized Product from API Categorizer:', JSON.stringify(recategorizedProduct, null, 2));

        // Capture original additional categorizations *before* any modification
        const originalAdditionalCategorizations = originalProduct.additional_categorizations
          ? JSON.parse(JSON.stringify(originalProduct.additional_categorizations)) // Deep copy
          : [];
        console.log('[DEBUG /api/process-recategorization-queue] Captured originalAdditionalCategorizations:', JSON.stringify(originalAdditionalCategorizations, null, 2));

        // First, create a copy of the original product with the recategorized primary category
        const tempUpdatedProduct = {
          ...originalProduct,
          category: recategorizedProduct.category,
          subcategory: recategorizedProduct.subcategory,
          product_type: recategorizedProduct.product_type,
          image_url: recategorizedProduct.image_url || originalProduct.image_url,
          name: recategorizedProduct.description || originalProduct.name || originalProduct.description,
          description: recategorizedProduct.description || originalProduct.description || originalProduct.name,
          brand: recategorizedProduct.brand || originalProduct.brand || null,
          is_organic: typeof recategorizedProduct.is_organic === 'boolean' ? recategorizedProduct.is_organic : originalProduct.is_organic === true,
          _categoryChanged: true,
          _originalCategory: originalProduct.category,
          _originalSubcategory: originalProduct.subcategory,
          _originalProductType: originalProduct.product_type,
          _originalAdditionalCategorizations: originalAdditionalCategorizations
        };

        // Handle dual categorization separately when needed
        let updatedProduct;

        // Condition to check if primary category, subcategory, or product_type has changed
        if (originalProduct.category !== recategorizedProduct.category ||
          originalProduct.subcategory !== recategorizedProduct.subcategory ||
          originalProduct.product_type !== recategorizedProduct.product_type) {

          console.log(`[INDEX.JS DEBUG /api/process-recategorization-queue] Primary C/S/PT changed.`);
          console.log(`    OLD: ${originalProduct.category} / ${originalProduct.subcategory} / ${originalProduct.product_type}`);
          console.log(`    NEW (from 1st categorizer call): ${recategorizedProduct.category} / ${recategorizedProduct.subcategory} / ${recategorizedProduct.product_type}`);
          console.log(`    Running direct categorization to refresh additional_categorizations...`);

          try {
            // Create product for direct categorization, ensuring it uses the NEW primary C/S/PT
            const productForCategorizer = {
              description: tempUpdatedProduct.description || tempUpdatedProduct.name, // tempUpdatedProduct already has new primary C/S/PT
              productId: tempUpdatedProduct.productId,
              category: tempUpdatedProduct.category,         // NEW primary category
              subcategory: tempUpdatedProduct.subcategory,     // NEW primary subcategory
              product_type: tempUpdatedProduct.product_type,   // NEW primary product_type
              image_url: tempUpdatedProduct.image_url,
              items: tempUpdatedProduct.items || [{ price: { regular: tempUpdatedProduct.price || 0 } }]
              // NOTE: We are NOT passing existing additional_categorizations from tempUpdatedProduct here,
              // because we want categorizeProducts to re-determine them from scratch based on the new primary.
            };

            console.log('[INDEX.JS DEBUG /api/process-recategorization-queue] Object being sent to SECOND (direct) categorizeProducts call:', JSON.stringify(productForCategorizer, null, 2));

            // Directly call categorizeProducts on the existing categorizer instance
            const directCategorizedResults = await categorizer.categorizeProducts([productForCategorizer]);

            // Log the raw result from the second call
            console.log('[INDEX.JS DEBUG /api/process-recategorization-queue] Raw result from SECOND (direct) categorizeProducts call (directCategorizedResults):', JSON.stringify(directCategorizedResults, null, 2));

            if (directCategorizedResults && directCategorizedResults.length > 0 && directCategorizedResults[0]) {
              const resultFromSecondCall = directCategorizedResults[0];
              console.log(`[INDEX.JS DEBUG /api/process-recategorization-queue] Direct categorization successful. Product after second call: ${resultFromSecondCall.description}. Found ${resultFromSecondCall.additional_categorizations?.length || 0} additional categories in its result.`);
              console.log(`[INDEX.JS DEBUG /api/process-recategorization-queue] Additional categories from second call:`, JSON.stringify(resultFromSecondCall.additional_categorizations, null, 2));

              updatedProduct = {
                ...tempUpdatedProduct, // tempUpdatedProduct has the new primary C/S/PT and all _original flags
                // Take additional_categorizations strictly from the result of this second, focused categorization call
                additional_categorizations: resultFromSecondCall.additional_categorizations || []
              };
            } else {
              console.warn(`[INDEX.JS DEBUG /api/process-recategorization-queue] Direct (second) categorization returned no results or an empty/invalid result. Product: ${tempUpdatedProduct.description}. Defaulting to empty additional_categorizations.`);
              updatedProduct = { ...tempUpdatedProduct }; // Use tempUpdatedProduct (which has new primary C/S/PT and _original flags)
              updatedProduct.additional_categorizations = []; // Set to empty as the direct call failed to provide them
            }
          } catch (categorizerError) {
            console.error(`[INDEX.JS DEBUG /api/process-recategorization-queue] Error during direct (second) categorization for ${tempUpdatedProduct.description}: ${categorizerError.message}`, categorizerError.stack);
            updatedProduct = { ...tempUpdatedProduct }; // Use tempUpdatedProduct
            updatedProduct.additional_categorizations = []; // Set to empty on error
          }
        } else {
          // Primary C/S/PT did NOT change.
          // The additional_categorizations from the first call to categorizer.categorizeProducts (which populated `recategorizedProduct`) are considered correct.
          console.log(`[INDEX.JS DEBUG /api/process-recategorization-queue] Primary C/S/PT did NOT change for ${recategorizedProduct.description}. Using additional_categorizations from initial recat queue processing.`);
          updatedProduct = { ...tempUpdatedProduct }; // tempUpdatedProduct already has the correct primary C/S/PT (same as original) and _original flags
          updatedProduct.additional_categorizations = recategorizedProduct.additional_categorizations || [];
        }
        console.log('[DEBUG /api/process-recategorization-queue] Final updatedProduct to be saved:', JSON.stringify(updatedProduct, null, 2));

        allCategorizedProducts[existingIndex] = updatedProduct;
        console.log(`Replacing product at index ${existingIndex}: ${originalProduct.category} -> ${updatedProduct.category}. Stored original additional cats count: ${originalAdditionalCategorizations.length}`);
      } else {
        // This case (product in queue but not in categorized_products.json) should be rare.
        // Add it as a new product, but flag it as if it just came from API for consistency.
        console.warn(`Product from recat queue (ID: ${productId}, Desc: ${description}) not found in categorized_products.json. Adding as new.`);
        const newProductToAdd = {
          ...recategorizedProduct,
          name: recategorizedProduct.description,
          brand: recategorizedProduct.brand || null,
          is_organic: typeof recategorizedProduct.is_organic === 'boolean' ? recategorizedProduct.is_organic : false,
          _categoryChanged: false,
          _originalCategory: null,
          _originalSubcategory: null,
          _originalProductType: null,
          _originalAdditionalCategorizations: null,
          price: recategorizedProduct.price ?? recategorizedProduct.items?.[0]?.price?.regular ?? 0,
          promo_price: recategorizedProduct.promo_price ?? recategorizedProduct.items?.[0]?.price?.promo ?? null,
          size: recategorizedProduct.size ?? recategorizedProduct.items?.[0]?.size ?? "",
          stocks_status: recategorizedProduct.stocks_status ?? recategorizedProduct.items?.[0]?.inventory?.stockLevel ?? "UNKNOWN",
          sold_by: recategorizedProduct.sold_by ?? recategorizedProduct.items?.[0]?.soldBy ?? null,
        };
        allCategorizedProducts.push(newProductToAdd);
      }
    }

    fs.writeFileSync(categorizedDataPath, JSON.stringify(allCategorizedProducts, null, 2));
    console.log(`Updated categorized_products.json with ${categorizedResults.length} recategorized products`);

    try {
      await runSortScript();
    } catch (sortError) {
      console.error('Error running sort_products.py after /api/process-recategorization-queue:', sortError.message);
      // Log and continue
    }

    // Update correction map again, ensuring the latest successful categorization is stored
    // This is important if the correction map led to a category that then got dual-categorized.
    // The correction map should reflect the final primary category.
    const finalCorrectionMap = { ...correctionMap }; // Start with the map that might have been temporarily modified
    // Re-read the original map if we didn't modify it above, or use the current `correctionMap`
    // if the temporary removal logic was complex. For simplicity, using the `correctionMap` that was loaded.

    categorizedResults.forEach(product => { // product here is result from API categorizer
      const originalQueuedProduct = productsInQueue.find(p => p.productId === product.productId || p.name === product.description);
      if (originalQueuedProduct && originalQueuedProduct.force_llm) {
        console.log(`Skipping correction map update for force_llm product: ${product.description || product.productId}`);
        return;
      }

      const productKeys = [];
      if (product.productId) productKeys.push(`productId:${product.productId}`);
      if (product.description) {
        const cleanName = product.description.replace(/[®™©]/g, '');
        productKeys.push(cleanName);
        productKeys.push(cleanName.toLowerCase());
      }

      productKeys.forEach(key => {
        if (!key) return; // Skip if key is somehow undefined or empty

        console.log(`[DEBUG CORRECTION_MAP_UPDATE] Processing key: '${key}' for product: ${product.description || product.productId}`);
        finalCorrectionMap[key] = {
          category: product.category, // The final primary category
          subcategory: product.subcategory,
          product_type: product.product_type,
          last_verified: new Date().toISOString()
        };
      });
      console.log(`Updated/Affirmed ${product.description || product.productId} in correction map with category: ${product.category}/${product.subcategory || 'N/A'}/${product.product_type || 'N/A'}`);
    });
    fs.writeFileSync(correctionMapPath, JSON.stringify(finalCorrectionMap, null, 2));

    const reportFile = path.join(__dirname, '../product-categorization/reported_categorizations.jsonl');
    if (fs.existsSync(reportFile)) {
      const reportContent = fs.readFileSync(reportFile, 'utf8'); // Renamed variable
      if (reportContent.trim()) {
        const lines = reportContent.trim().split('\n');
        let reportsUpdated = false; // Renamed variable

        productsInQueue.forEach(productInQ => {
          if (productInQ.report_id !== undefined) {
            const reportId = parseInt(productInQ.report_id, 10);
            if (!isNaN(reportId) && reportId >= 0 && reportId < lines.length) {
              try {
                const report = JSON.parse(lines[reportId]);
                report.status = 'recategorized';
                report.recategorized_at = new Date().toISOString();
                lines[reportId] = JSON.stringify(report);
                reportsUpdated = true;
                console.log(`Updated report ${reportId} status to recategorized`);
              } catch (e) {
                console.error(`Error parsing report line ${reportId}: ${lines[reportId]}`, e);
              }
            }
          }
        });

        if (reportsUpdated) {
          fs.writeFileSync(reportFile, lines.join('\n') + '\n');
        }
      }
    }

    fs.writeFileSync(queuePath, JSON.stringify([])); // Clear queue

    res.json({
      success: true,
      processed: productsInQueue.length,
      message: `Successfully recategorized ${productsInQueue.length} products`
    });
  } catch (error) {
    console.error('Error processing recategorization queue:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve or reject a report
app.post('/api/approve-category-report', (req, res) => {
  try {
    console.log('Request:', req.body);

    const { reportId, approve } = req.body;
    if (reportId === undefined || approve === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const reportFile = path.join(__dirname, '../product-categorization/reported_categorizations.jsonl');
    const correctionMapFile = path.join(__dirname, '../product-categorization/correction_map.json');

    // Read reports
    const content = fs.readFileSync(reportFile, 'utf8');
    const lines = content.trim().split('\n');
    const reports = lines.map(line => JSON.parse(line));

    const index = parseInt(reportId, 10);

    if (isNaN(index) || index < 0 || index >= reports.length) {
      return res.status(404).json({ error: `Report not found: ${reportId}` });
    }

    // Mark the report as approved or rejected
    const report = reports[index];
    report.status = approve ? 'approved' : 'rejected';
    report.reviewed_at = new Date().toISOString();

    // Save the updated report
    const updatedLines = reports.map(r => JSON.stringify(r));
    fs.writeFileSync(reportFile, updatedLines.join('\n') + '\n');

    // If approved, update the correction map
    if (approve) {
      // For negative examples, do not update correction map
      if (report.type === "negative_example") {
        console.log(`Report ${reportId} approved as negative example - not adding to correction map`);
        return res.json({ success: true });
      }

      // Load existing correction map or create empty one
      let correctionMap = {};
      if (fs.existsSync(correctionMapFile)) {
        try {
          correctionMap = JSON.parse(fs.readFileSync(correctionMapFile, 'utf8'));
        } catch (err) {
          console.error('Error reading correction map file:', err);
          correctionMap = {};
        }
      }

      try {
        // Check if suggestedCategory exists before using it
        if (!report.suggestedCategory) {
          return res.status(400).json({ error: 'Missing suggested category in report' });
        }

        console.log(`[DEBUG APPROVE_REPORT] report.product object:`, JSON.stringify(report.product, null, 2));
        console.log(`[DEBUG APPROVE_REPORT] report.product.productId value: ${report.product.productId}`);
        console.log(`[DEBUG APPROVE_REPORT] typeof report.product.productId: ${typeof report.product.productId}`);

        // 1. Store product ID match (most reliable)
        if (report.product.productId) {
          correctionMap[`productId:${report.product.productId}`] = {
            category: report.suggestedCategory.category,
            subcategory: report.suggestedCategory.subcategory,
            product_type: report.suggestedCategory.product_type,
            last_verified: new Date().toISOString()
          };
          console.log(`Added product ID mapping: productId:${report.product.productId}`);
        }

        // 2. Store exact product name (case preserved but without special chars)
        const cleanName = report.product.name.replace(/[®™©]/g, '');
        correctionMap[cleanName] = {
          category: report.suggestedCategory.category,
          subcategory: report.suggestedCategory.subcategory,
          product_type: report.suggestedCategory.product_type,
          last_verified: new Date().toISOString()
        };
        console.log(`Added clean name mapping: ${cleanName}`);

        // 3. Store exact product name (lowercase)
        correctionMap[cleanName.toLowerCase()] = {
          category: report.suggestedCategory.category,
          subcategory: report.suggestedCategory.subcategory,
          product_type: report.suggestedCategory.product_type,
          last_verified: new Date().toISOString()
        };
        console.log(`Added lowercase name mapping: ${cleanName.toLowerCase()}`);

        // 4. For Reser's products specifically, add brand-specific match
        if (cleanName.toLowerCase().includes('reser')) {
          const reserSpecificName = cleanName.toLowerCase().replace(/reser'?s\s+/i, '');
          correctionMap[reserSpecificName] = {
            category: report.suggestedCategory.category,
            subcategory: report.suggestedCategory.subcategory,
            product_type: report.suggestedCategory.product_type,
            last_verified: new Date().toISOString()
          };
          console.log(`Added Reser's specific mapping: ${reserSpecificName}`);
        }

        // Save updated correction map
        fs.writeFileSync(correctionMapFile, JSON.stringify(correctionMap, null, 2));
        console.log(`Report ${reportId} approved and added to correction map with multiple keys`);
      } catch (err) {
        console.error('Error updating correction map:', err);
        return res.status(500).json({ error: 'Failed to update correction map' });
      }
    } else {
      console.log(`Report ${reportId} rejected`);
    }

    // Handle negative examples
    if (report.type === "negative_example") {
      const pythonProcess = spawn('/home/bur1/Holochain/Moss/summon/env/bin/python3', [
        'add_negative_example.py',
        '--product', report.product.name,
        '--category', report.currentCategory.category,
        '--subcategory', report.currentCategory.subcategory,
        '--product_type', report.currentCategory.product_type
      ], {
        cwd: '/home/bur1/Holochain/Moss/summon/product-categorization'
      });

      let output = '';
      pythonProcess.stdout.on('data', (data) => output += data);

      pythonProcess.stderr.on('data', (data) => {
        console.error('Error in negative example script:', data.toString());
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`Negative example process exited with code ${code}`);
        } else {
          console.log(`Successfully added negative example for ${report.product.name}`);
        }
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error processing report approval:', error);
    return res.status(500).json({ error: `Failed to process report: ${error.message}` });
  }
});

app.post('/api/rebuild-categorizer', async (req, res) => {
  try {
    // Spawn the Python rebuild script
    const pythonProcess = spawn('/home/bur1/Holochain/Moss/summon/env/bin/python3', [
      'rebuild_index.py'
    ], {
      cwd: '/home/bur1/Holochain/Moss/summon/product-categorization',
      maxBuffer: 1024 * 1024 * 10
    });

    let output = '';
    pythonProcess.stdout.on('data', (data) => output += data);

    let errorOutput = '';
    pythonProcess.stderr.on('data', (data) => {
      console.error('Python rebuild error:', data.toString());
      errorOutput += data;
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python rebuild process exited with code ${code}`);
        return res.status(500).json({
          success: false,
          error: `Process exited with code ${code}`,
          details: errorOutput
        });
      }

      try {
        const result = JSON.parse(output);
        res.json(result);
      } catch (e) {
        // Try to extract just the last line which should be the JSON
        const lastLine = output.trim().split('\n').pop();
        try {
          const result = JSON.parse(lastLine);
          res.json(result);
        } catch (lastLineError) {
          console.error('Invalid JSON output from rebuild script:', e);
          res.status(500).json({
            success: false,
            error: 'Invalid output from rebuild script',
            details: output
          });
        }
      }
    });
  } catch (error) {
    console.error('Error running rebuild script:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/convert-failed-categorizations', (req, res) => {
  try {
    const pythonProcess = spawn('/home/bur1/Holochain/Moss/summon/env/bin/python3', [
      'convert_failures.py'
    ], {
      cwd: '/home/bur1/Holochain/Moss/summon/product-categorization',
    });

    let output = '';
    pythonProcess.stdout.on('data', (data) => output += data);

    let errorOutput = '';
    pythonProcess.stderr.on('data', (data) => {
      console.error('Python conversion error:', data.toString());
      errorOutput += data;
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python process exited with code ${code}`);
        return res.status(500).json({
          success: false,
          error: `Process exited with code ${code}`,
          details: errorOutput
        });
      }

      try {
        const result = JSON.parse(output);
        res.json(result);
      } catch (e) {
        // Try to extract just the last line which should be the JSON
        const lastLine = output.trim().split('\n').pop();
        try {
          const result = JSON.parse(lastLine);
          res.json(result);
        } catch (lastLineError) {
          console.error('Invalid JSON output from conversion script:', e);
          res.status(500).json({
            success: false,
            error: 'Invalid output from conversion script',
            details: output
          });
        }
      }
    });
  } catch (error) {
    console.error('Error running conversion script:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/update-report-category', (req, res) => {
  try {
    const { reportId, suggestedCategory } = req.body;

    // Add this line to define reportFile:
    const reportFile = path.join(__dirname, '../product-categorization/reported_categorizations.jsonl');

    // Rest of your code...
    const content = fs.readFileSync(reportFile, 'utf8');
    const lines = content.trim().split('\n');
    const reports = lines.map(line => JSON.parse(line));

    // Update the report
    reports[reportId].suggestedCategory = suggestedCategory;

    // Write back to file
    fs.writeFileSync(reportFile, reports.map(r => JSON.stringify(r)).join('\n') + '\n');

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating report:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/load-categorized-products', (req, res) => {
  const categorizedDataPath = path.join(__dirname, '../product-categorization/categorized_products_sorted_with_embeddings.json');
  console.log(`Looking for categorized products at: ${categorizedDataPath}`);

  if (!fs.existsSync(categorizedDataPath)) {
    console.log('No saved categorized products file found');
    return res.json([]); // Return empty array if file doesn't exist
  }

  const products = [];
  const fileStream = fs.createReadStream(categorizedDataPath, { encoding: 'utf8' });
  // Create the JSON parsing pipeline
  const jsonPipeline = fileStream.pipe(parser()).pipe(streamArray());

  let count = 0; // To count products as they are streamed

  // Event listener for each product object streamed from the array
  jsonPipeline.on('data', ({ key, value }) => {
    // 'key' is the array index (0, 1, 2,...), 'value' is the actual product object
    products.push(value);
    count++;
    if (count % 10000 === 0) { // Optional: Log progress for very large files
      console.log(`[STREAM LOAD] Streaming... Loaded ${count} products so far.`);
    }
  });

  // Event listener for the end of the stream
  jsonPipeline.on('end', () => {
    console.log(`Loaded ${products.length} categorized products from saved file via stream.`);
    res.json(products); // Send the complete array of products
  });

  // Error handling for the JSON parsing pipeline
  jsonPipeline.on('error', (err) => {
    console.error('Error streaming or parsing categorized products JSON:', err);
    if (!res.headersSent) { // Check if headers are already sent to avoid Express error
      res.status(500).json({ error: `Failed to load categorized products via stream: ${err.message}` });
    }
  });

  // Error handling for the file stream itself (e.g., file not readable, permissions issues)
  fileStream.on('error', (err) => {
    console.error('Error reading categorized products file stream:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to read categorized products file: ${err.message}` });
    }
  });
});

app.get('/api/check-dht-upload-flag', (req, res) => {
  const flagPath = path.join(__dirname, '../product-categorization/needs_dht_upload.flag');
  console.log(`Checking for DHT upload flag at: ${flagPath}`);
  const flagExists = fs.existsSync(flagPath);
  res.json({ flagExists });
});

// Delete DHT upload flag
app.post('/api/delete-dht-upload-flag', (req, res) => {
  const flagPath = path.join(__dirname, '../product-categorization/needs_dht_upload.flag');
  console.log(`Attempting to delete DHT upload flag at: ${flagPath}`);
  if (fs.existsSync(flagPath)) {
    fs.unlinkSync(flagPath);
    console.log("Deleted DHT upload flag file");
  }
  res.json({ success: true });
});

app.get('/api/load-changed-product-types', (req, res) => {
  try {
    const changeTrackingPath = path.join(__dirname, '../product-categorization/changed_product_types.json');
    console.log(`Looking for changed product types at: ${changeTrackingPath}`);

    if (!fs.existsSync(changeTrackingPath)) {
      console.log('No changed product types file found');
      return res.json([]);
    }

    const fileContent = fs.readFileSync(changeTrackingPath, 'utf8');

    if (!fileContent.trim()) {
      console.log('Changed product types file is empty');
      return res.json([]);
    }

    const changedTypes = JSON.parse(fileContent);
    console.log(`Loaded ${changedTypes.length} changed product types`);

    return res.json(changedTypes);
  } catch (error) {
    console.error('Error loading changed product types:', error);
    return res.status(500).json({ error: `Failed to load changed product types: ${error.message}` });
  }
});

app.post('/api/reset-change-flags', async (req, res) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'No product IDs provided' });
    }

    const categorizedDataPath = path.join(__dirname, '../product-categorization/categorized_products.json');
    if (!fs.existsSync(categorizedDataPath)) {
      return res.status(404).json({ error: 'Categorized products file not found' });
    }

    const products = JSON.parse(fs.readFileSync(categorizedDataPath, 'utf8'));
    let updatedCount = 0;

    for (const product of products) {
      // Check if product.productId exists and if it's in the productIds list
      if (product.productId && productIds.includes(product.productId)) {
        // Only reset if _categoryChanged was true, to avoid unnecessary writes or logic
        if (product._categoryChanged === true) {
          product._categoryChanged = false;
          product._originalCategory = null;
          product._originalSubcategory = null;
          product._originalProductType = null;
          product._originalAdditionalCategorizations = null; // Reset this field
          updatedCount++;
          console.log(`ReseT flags for productId: ${product.productId}`);
        }
      }
    }

    if (updatedCount > 0) {
      fs.writeFileSync(categorizedDataPath, JSON.stringify(products, null, 2));
      console.log(`Saved ${updatedCount} products with reset flags to ${categorizedDataPath}`);

      // Trigger re-sort only if changes were made
      try {
        await runSortScript();
      } catch (sortError) {
        console.error('Error running sort_products.py after /api/reset-change-flags:', sortError.message);
        // Log and continue
      }
    } else {
      console.log("No products required flag resets.");
    }

    return res.json({ success: true, resetCount: updatedCount });
  } catch (error) {
    console.error('Error resetting change flags:', error);
    return res.status(500).json({ error: error.message });
  }
});