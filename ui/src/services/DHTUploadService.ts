// DHTUploadService.ts - Handles product catalog upload to Holochain DHT

import { normalizeStatus } from "../utils/stockUtils";
import { createAndActivateClone, disableClone } from "../products/utils/cloneHelpers";

// Exported service instance for direct imports
export let uploadService: ProductsUploadService | null = null;

export function setUploadService(service: ProductsUploadService): void {
    uploadService = service;
}


// Add this function to normalize promo prices during DHT sync
function normalizePromoPrice(promoPrice: number | null | undefined, regularPrice: number | null | undefined): number | null {
  if (promoPrice === null || promoPrice === undefined || promoPrice === 0 ||
    typeof promoPrice !== 'number' || isNaN(promoPrice) ||
    typeof regularPrice !== 'number' || isNaN(regularPrice) ||
    promoPrice >= regularPrice) {
    return null;
  }
  return promoPrice;
}

export class ProductsUploadService {
  constructor(
    public client: any,
    private store: any
  ) {}

  // Simple upload progress callback
  private onProgress?: (message: string, progress: number) => void;

  setProgressCallback(callback: (message: string, progress: number) => void) {
    this.onProgress = callback;
  }

  private updateProgress(message: string, progress: number = 0) {
    if (this.onProgress) {
      this.onProgress(message, progress);
    }
    console.log(`[UPLOAD] ${message} (${progress}%)`);
  }



  async loadFromSavedData() {
    console.log("[LOG] ⚡ Load Saved Data: Process started.");
    this.updateProgress("Creating new product catalog clone...", 0);

    let totalProductsFromFile = 0;
    let successfullyUploadedProducts = 0;
    let totalGroupsCreated = 0;

    try {
      // Step 1: Create new catalog clone for fresh data upload
      const { clonedCell, previousCellId } = await this.createNewClone();

      // Step 2: Load and validate data from API
      const data = await this.loadProductDataFromAPI();
      totalProductsFromFile = data.length;

      // Step 3: Group products by category/subcategory/product_type
      const productsByType = this.groupProductsByType(data);
      
      // Step 4: Upload all product groups
      const uploadResults = await this.uploadAllProductGroups(
        productsByType, 
        clonedCell, 
        totalProductsFromFile
      );
      
      successfullyUploadedProducts = uploadResults.successfullyUploadedProducts;
      totalGroupsCreated = uploadResults.totalGroupsCreated;

      // Step 5: Cleanup old clone
      await this.cleanupOldClone(previousCellId, successfullyUploadedProducts);

      console.log("🎉 Upload process complete - new clone active, old clone disabled");
      this.updateProgress(`✅ Complete: ${successfullyUploadedProducts}/${totalProductsFromFile} products in ${totalGroupsCreated} groups`, 100);

    } catch (error: unknown) {
      console.error("[LOG] Load Saved Data: ❌ Critical error:", error);
      this.updateProgress(`❌ Upload failed: ${successfullyUploadedProducts}/${totalProductsFromFile} products uploaded`, 0);
      throw error; // Re-throw for caller to handle
    }
  }

  private async createNewClone() {
    console.log("🚀 STARTING UPLOAD PROCESS");
    const cloneResult = await createAndActivateClone(this.store.client);
    const clonedCell = { cell_id: cloneResult.cellId, seed: cloneResult.seed };
    const previousCellId = cloneResult.previousCellId;
    
    console.log("📦 Will upload data to clone:", cloneResult.seed.slice(0, 8));
    
    return { clonedCell, previousCellId };
  }

  private async loadProductDataFromAPI(): Promise<any[]> {
    this.updateProgress("📡 Loading saved products from file...", 10);
    const response = await fetch('http://localhost:3000/api/load-categorized-products');

    if (!response.ok) {
      throw new Error(`Failed to load saved products: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      console.error("[LOG] Load Saved Data: Fetched data is not an array.", data);
      throw new Error("Invalid data format from API: Expected an array of products.");
    }

    return data;
  }

  private groupProductsByType(data: any[]): Record<string, any[]> {
    const productsByType = data.reduce((groups: Record<string, any[]>, product: any) => {
      const category = product.category;
      const subcategory = product.subcategory || null;
      const productType = product.product_type === "All" || !product.product_type ? null : product.product_type;
      const key = `${category}|||${subcategory}|||${productType}`;

      if (!groups[key]) groups[key] = [];
      groups[key].push(product);
      return groups;
    }, {} as Record<string, any[]>);

    const productTypesCount = Object.keys(productsByType).length;
    console.log(`Starting upload: ${data.length} products in ${productTypesCount} groups`);

    return productsByType;
  }

  private async uploadAllProductGroups(
    productsByType: Record<string, any[]>, 
    clonedCell: any, 
    totalProductsFromFile: number
  ) {
    this.updateProgress(`📡 Starting upload to NEW clone: 0/${totalProductsFromFile} products`, 20);

    let processedTypes = 0;
    let successfullyUploadedProducts = 0;
    let totalGroupsCreated = 0;
    const productTypesCount = Object.keys(productsByType).length;

    for (const [key, productList] of Object.entries(productsByType)) {
      if (!Array.isArray(productList)) {
        console.warn(`[LOG] Load Saved Data: Expected an array for key ${key} but got:`, productList);
        continue;
      }

      const [, , productTypeFromFile] = key.split('|||');
      processedTypes++;

      const uploadResult = await this.uploadProductGroup(
        productList, 
        clonedCell, 
        productTypeFromFile,
        successfullyUploadedProducts,
        totalProductsFromFile
      );

      successfullyUploadedProducts += uploadResult.productsUploaded;
      totalGroupsCreated += uploadResult.groupsCreated;

      // Pause between product types
      if (processedTypes < productTypesCount) {
        await new Promise(resolve => setTimeout(resolve, 125));
      }
    }

    console.log(`✅ UPLOAD COMPLETE: ${successfullyUploadedProducts}/${totalProductsFromFile} products in ${totalGroupsCreated} groups uploaded to clone ${clonedCell.seed.slice(0, 8)}`);
    
    return { successfullyUploadedProducts, totalGroupsCreated };
  }

  private async uploadProductGroup(
    productList: any[], 
    clonedCell: any, 
    productTypeFromFile: string,
    currentSuccessfullyUploaded: number,
    totalProductsFromFile: number
  ) {
    const processedBatch = this.transformProductsForUpload(productList);
    
    let success = false;
    let attempts = 0;

    while (!success && attempts < 3) {
      try {
        attempts++;
        const records = await this.client.callZome({
          cell_id: clonedCell.cell_id,
          zome_name: "product_catalog",
          fn_name: "create_product_batch",
          payload: processedBatch,
        });

        const recordsLength = Array.isArray(records) ? records.length : 0;
        success = true;

        const newTotal = currentSuccessfullyUploaded + productList.length;
        const uploadPercent = Math.round((newTotal / totalProductsFromFile) * 100);
        this.updateProgress(`Uploaded ${newTotal}/${totalProductsFromFile} products - ${recordsLength} groups created`, 20 + (uploadPercent * 0.6));

        return { productsUploaded: productList.length, groupsCreated: recordsLength };

      } catch (batchError: unknown) {
        console.error(`❌ Upload batch failed (attempt ${attempts}/3):`, batchError);
        if (attempts >= 3) {
          console.warn(`Skipping product type after 3 failed attempts`);
          break;
        }

        const delayMs = 3000 * Math.pow(2, attempts - 1);
        this.updateProgress(`Retry ${attempts}/3: "${productTypeFromFile || 'None'}" failed - Retrying in ${delayMs / 1000}s`, 0);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return { productsUploaded: 0, groupsCreated: 0 };
  }

  private transformProductsForUpload(productList: any[]) {
    return productList.map((product: any) => ({
      product: {
        name: product.description || "",
        price: (typeof product.price === 'number') ? product.price : (product.items?.[0]?.price?.regular ?? 0),
        promo_price: normalizePromoPrice(product.promo_price, product.price),
        size: product.size || "",
        stocks_status: normalizeStatus(product.stocks_status),
        category: product.category,
        subcategory: product.subcategory || null,
        product_type: product.product_type === "All" || !product.product_type ? null : product.product_type,
        image_url: product.image_url || null,
        sold_by: product.sold_by || null,
        productId: product.productId,
        upc: product.upc || null,
        embedding: product.embedding || null,
        brand: product.brand || null,
        is_organic: product.is_organic || false,
      },
      main_category: product.category,
      subcategory: product.subcategory || null,
      product_type: product.product_type === "All" || !product.product_type ? null : product.product_type,
      additional_categorizations: product.additional_categorizations || []
    }));
  }

  private async cleanupOldClone(previousCellId: any, successfullyUploadedProducts: number) {
    if (previousCellId && successfullyUploadedProducts > 0) {
      console.log("🗑️ Disabling previous clone after successful upload...");
      await disableClone(this.store.client, previousCellId);
    }
  }
}
