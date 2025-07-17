import { decodeProducts } from "./search-utils";
import type { Product } from "./search-types";
import { decode } from "@msgpack/msgpack";
import type { DecodedProductGroupEntry } from "./search-utils";
import { getActiveCloneCellId } from "../products/utils/cloneHelpers";



/**
 * API client for search-related operations
 */
export class SearchApiClient {
    private store: any;

    constructor(store: any) {
        this.store = store;
    }

    // Get the cell_id for targeting the current active clone
    private async getActiveCloneCellId(): Promise<any> {
        const cellId = await getActiveCloneCellId(this.store.service.client);
        console.log("🔎 [SEARCH API] ✅ Targeting clone cell:", cellId);
        return cellId;
    }

    /**
     * Fetch product by composite hash (groupHash + index)
     */
    async getProductByHash(hash: any): Promise<Product | null> {
        console.log("API LOOKUP:", {
            hash,
            hasGroupHash: hash && hash.groupHash,
            hasIndex: hash && typeof hash.index === 'number'
        });
        try {
            // Check if we have a composite hash with groupHash and index
            if (hash && hash.groupHash && typeof hash.index === 'number') {
                const reference = {
                    group_hash: hash.groupHash,
                    index: hash.index
                };

                const cellId = await this.getActiveCloneCellId();
                const response = await this.store.service.client.callZome({
                    cell_id: cellId,
                    zome_name: "product_catalog",
                    fn_name: "get_products_by_references",
                    payload: [reference],
                });

                if (!response.products?.length) return null;

                // Extract the product from the group
                const group = decodeProducts([response.products[0]])[0];
                if (group && group.products && group.products[hash.index]) {
                    const product = group.products[hash.index];
                    return {
                        ...product,
                        hash: {
                            groupHash: hash.groupHash,
                            index: hash.index,
                            toString: function () {
                                return `${this.groupHash}:${this.index}`;
                            }
                        }
                    };
                }
                return null;
            } else {
                // Fallback for old-style hashes (backward compatibility)
                console.warn("Using legacy hash format - this should be updated");
                const cellId = await this.getActiveCloneCellId();
                const response = await this.store.service.client.callZome({
                    cell_id: cellId,
                    zome_name: "product_catalog",
                    fn_name: "get_products_by_hashes",
                    payload: [hash],
                });

                if (!response.products?.length) return null;

                const products = decodeProducts(response.products);
                return products[0] || null;
            }
        } catch (error) {
            console.error("Error fetching product by hash:", error);
            return null;
        }
    }

    /**
     * Fetch all matching products by hash
     */
    async getAllProductVersionsByHash(hash: any): Promise<Product[]> {
        try {
            if (hash && hash.groupHash && typeof hash.index === 'number') {
                console.log("API LOOKUP DETAILS:", {
                    groupHash: hash.groupHash,
                    index: hash.index
                });

                const reference = {
                    group_hash: hash.groupHash,
                    index: hash.index
                };

                const cellId = await this.getActiveCloneCellId();
                const response = await this.store.service.client.callZome({
                    cell_id: cellId,
                    zome_name: "product_catalog",
                    fn_name: "get_products_by_references",
                    payload: [reference],
                });

                console.log("API RESPONSE:", {
                    hasProducts: !!response.products?.length,
                    productCount: response.products?.length || 0
                });

                if (!response.products?.length) return [];

                // Extract products directly from group entries
                const products: Product[] = [];

                for (const record of response.products) {
                    try {
                        const groupHash = record.signed_action.hashed.hash;
                        const groupData = await decodeEntry(record.entry.Present.entry);

                        console.log("FOUND GROUP:", {
                            hasProducts: !!groupData?.products,
                            productCount: groupData?.products?.length || 0,
                            requestedIndex: hash.index
                        });

                        if (groupData?.products && hash.index < groupData.products.length) {
                            const product = groupData.products[hash.index];
                            products.push({
                                ...product,
                                hash: {
                                    groupHash,
                                    index: hash.index,
                                    toString: function () {
                                        return `${this.groupHash}:${this.index}`;
                                    }
                                }
                            });
                        }
                    } catch (error) {
                        console.error("Error extracting product:", error);
                    }
                }

                console.log("EXTRACTED PRODUCTS:", products.length);
                return products;
            } else {
                // Fallback for old-style hashes
                console.warn("Using legacy hash format - this should be updated");
                const cellId = await this.getActiveCloneCellId();
                const response = await this.store.service.client.callZome({
                    cell_id: cellId,
                    zome_name: "product_catalog",
                    fn_name: "get_products_by_hashes",
                    payload: [hash],
                });

                if (!response.products?.length) return [];
                return decodeProducts(response.products);
            }
        } catch (error) {
            console.error("Error fetching products by hash:", error);
            return [];
        }
    }

    /**
     * Fetch products by category, subcategory, and product type
     */
    async getProductsByType(
        category: string,
        subcategory: string | null | undefined,
        productType: string | null | undefined,
        limit: number = 200
    ): Promise<{ products: Product[], total: number }> {
        const logKey = `api-getProductsByType-${category}-${subcategory || 'none'}-${productType || 'none'}`;
        console.time(logKey);
        try {
            const cellId = await this.getActiveCloneCellId();
            const response = await this.store.service.client.callZome({
                cell_id: cellId,
                zome_name: "product_catalog",
                fn_name: "get_products_by_category",
                payload: {
                    category,
                    subcategory,
                    product_type: productType,
                    limit,
                },
            });

            // Extract products from product groups
            const products: Product[] = [];
            let total = 0;

            if (response.product_groups) {
                for (const groupRecord of response.product_groups) {
                    try {
                        const groupHash = groupRecord.signed_action.hashed.hash;
                        const groupData = decodeEntry(groupRecord.entry.Present.entry);

                        if (groupData && Array.isArray(groupData.products)) {
                            total += groupData.products.length;

                            groupData.products.forEach((product: any, index: number) => {
                                products.push({
                                    ...product,
                                    hash: {
                                        groupHash,
                                        index,
                                        toString: function () {
                                            return `${this.groupHash}:${this.index}`;
                                        }
                                    }
                                });
                            });
                        }
                    } catch (error) {
                        console.error("Error processing product group:", error);
                    }
                }
            }

            console.timeEnd(logKey);
            console.log(`Fetched ${products.length}/${total} products from ${category}/${subcategory || 'none'}/${productType || 'none'}`);

            return {
                products,
                total: total
            };
        } catch (error) {
            console.timeEnd(logKey);
            console.error(`Error fetching products by type from ${category}/${subcategory || 'none'}/${productType || 'none'}:`, error);
            return { products: [], total: 0 };
        }
    }

    /**
     * Fetch additional subcategory products
     */
    async getAdditionalSubcategoryProducts(
        category: string,
        subcategory: string,
        excludedProductType: string | null | undefined,
        limit: number = 20
    ): Promise<Product[]> {
        try {
            const cellId = await this.getActiveCloneCellId();
            const response = await this.store.service.client.callZome({
                cell_id: cellId,
                zome_name: "product_catalog",
                fn_name: "get_products_by_category",
                payload: {
                    category,
                    subcategory,
                    limit,
                },
            });

            if (!response.product_groups?.length) return [];

            // Extract products from each group
            const products: Product[] = [];

            for (const groupRecord of response.product_groups) {
                try {
                    const groupHash = groupRecord.signed_action.hashed.hash;
                    const groupData = decodeEntry(groupRecord.entry.Present.entry);

                    if (groupData && Array.isArray(groupData.products)) {
                        groupData.products.forEach((product: any, index: number) => {
                            // Skip products of excluded type
                            if (excludedProductType && product.product_type === excludedProductType) {
                                return;
                            }

                            products.push({
                                ...product,
                                hash: {
                                    groupHash,
                                    index,
                                    toString: function () {
                                        return `${this.groupHash}:${this.index}`;
                                    }
                                }
                            });
                        });
                    }
                } catch (error) {
                    console.error("Error processing product group:", error);
                }
            }

            return products;
        } catch (error) {
            console.error("Error fetching subcategory products:", error);
            return [];
        }
    }

    /**
     * Fetch all products from a category
     */
    async getAllCategoryProducts(category: string): Promise<Product[]> {
        try {
            const cellId = await this.getActiveCloneCellId();
            const response = await this.store.service.client.callZome({
                cell_id: cellId,
                zome_name: "product_catalog",
                fn_name: "get_all_category_products",
                payload: category,
            });

            if (!response.product_groups?.length) return [];

            // Extract products from each group
            const products: Product[] = [];

            for (const groupRecord of response.product_groups) {
                try {
                    const groupHash = groupRecord.signed_action.hashed.hash;
                    const groupData = decodeEntry(groupRecord.entry.Present.entry);

                    if (groupData && Array.isArray(groupData.products)) {
                        groupData.products.forEach((product: any, index: number) => {
                            products.push({
                                ...product,
                                hash: {
                                    groupHash,
                                    index,
                                    toString: function () {
                                        return `${this.groupHash}:${this.index}`;
                                    }
                                }
                            });
                        });
                    }
                } catch (error) {
                    console.error("Error processing product group:", error);
                }
            }

            return products;
        } catch (error) {
            console.error("Error fetching category products:", error);
            return [];
        }
    }
}

function decodeEntry(entry: any): DecodedProductGroupEntry | null {
    try {
        return decode(entry) as DecodedProductGroupEntry | null;
    } catch (error) {
        console.error("Error decoding entry:", error);
        return null;
    }
}