/**
 * Product interface with unified hash handling
 */
export interface Product {
    name: string;
    hash: CompositeHash;
    category?: string;
    subcategory?: string;
    product_type?: string;
    price?: number;
    promo_price?: number;
    size?: string;
    stocks_status?: string;
    image_url?: string;
    sold_by?: string;
    productId?: string;
    upc?: string; // UPC for preference lookups
    brand?: string;
    embedding?: Float32Array | number[]; // For semantic search
    isType?: boolean; // Flag for dropdown display
    [key: string]: any;
}

/**
 * Traditional ActionHash type (maintained for backward compatibility)
 */
export type ActionHash = Uint8Array | any;

/**
 * Composite hash type that contains group hash and index
 */
export interface CompositeHash {
    groupHash: ActionHash;
    index: number;
    toString: () => string;
}

/**
 * Generic search result that can include score information
 */
export interface SearchResult<T = Product> {
    item: T;
    score?: number;
    matches?: any[];
}

/**
 * Search result with relevance information
 */
export interface RankedSearchResult {
    product: Product;
    score: number;
    similarity?: number; // For semantic search
}

/**
 * Grouped products for UI presentation
 */
export interface CategoryGroupedProducts {
    sameTypeProducts: Product[];
    sameSubcategoryProducts: Product[];
    sameCategoryProducts: Product[];
    otherProducts: Product[];
}


/**
 * Product reference for backend API
 */
export interface ProductReference {
    group_hash: ActionHash;
    index: number;
}

/**
 * Product type grouping for dropdowns
 */
export interface ProductTypeGroup {
    type: string;
    count: number;
    sample: Product;
    isType: boolean;
}