/**
 * Cart helper utilities to eliminate duplicated logic across components
 * Following the PriceService pattern for centralized utility functions
 */

/**
 * Determines increment value based on product type
 * Weight products: 0.25 lb increments
 * Unit products: 1 ct increments
 */
export function getIncrementValue(product: any): number {
    return product?.sold_by === "WEIGHT" ? 0.25 : 1;
}

/**
 * Gets display unit based on product type
 * Weight products: "lbs"
 * Unit products: "ct"
 */
export function getDisplayUnit(product: any): string {
    return product?.sold_by === "WEIGHT" ? "lbs" : "ct";
}

/**
 * Checks if product is sold by weight
 */
export function isSoldByWeight(product: any): boolean {
    return product?.sold_by === "WEIGHT";
}

/**
 * Parses product hash to extract groupHash and productIndex
 * Handles both original products (with hash) and reconstructed products (with groupHash/productIndex)
 */
export function parseProductHash(product: any): { groupHash: string | null, productIndex: number | null, productId: string | null } {
    // Handle cart items with direct productId
    if (product?.productId && typeof product.productId === 'string') {
        const parts = product.productId.split(':');
        if (parts.length === 2) {
            const groupHash = parts[0];
            const productIndex = parseInt(parts[1]);
            return { groupHash, productIndex, productId: product.productId };
        }
    }
    
    // Handle cart items (already parsed)
    if (product?.groupHash && typeof product?.productIndex === 'number') {
        return createParsedHash(product.groupHash, product.productIndex);
    }
    
    // Handle CompositeHash objects from search results
    if (product?.hash && typeof product.hash === 'object' && product.hash.groupHash && typeof product.hash.index === 'number') {
        return createParsedHash(product.hash.groupHash, product.hash.index);
    }
    
    // Handle original products with string hash
    return parseFromHashProperty(product?.hash);
}

function createParsedHash(groupHash: string, productIndex: number) {
    const productId = `${groupHash}:${productIndex}`;
    return { groupHash, productIndex, productId };
}

function parseFromHashProperty(hash: string | undefined | any) {
    if (!hash) {
        return { groupHash: null, productIndex: null, productId: null };
    }
    
    // Handle CompositeHash objects that may have slipped through
    if (typeof hash === 'object' && hash.groupHash && typeof hash.index === 'number') {
        return createParsedHash(hash.groupHash, hash.index);
    }
    
    // Handle string hash format
    if (typeof hash !== 'string') {
        return { groupHash: null, productIndex: null, productId: null };
    }
    
    const hashParts = hash.split('_');
    if (hashParts.length < 2) {
        return { groupHash: null, productIndex: null, productId: null };
    }
    
    const productIndex = parseInt(hashParts[hashParts.length - 1]);
    const groupHash = hashParts.slice(0, -1).join('_');
    
    if (!groupHash || isNaN(productIndex)) {
        return { groupHash: null, productIndex: null, productId: null };
    }
    
    return createParsedHash(groupHash, productIndex);
}

/**
 * Formats quantity for display based on product type
 */
export function formatQuantityDisplay(quantity: number, product: any): string {
    const unit = getDisplayUnit(product);
    return `${quantity} ${unit}`;
}

/**
 * Maps CartItem objects to payload format for Holochain operations
 * Eliminates duplicate mapping logic across services
 */
export function mapCartItemsToPayload(cartItems: any[]) {
    return cartItems.map(item => ({
        product_id: item.productId,
        upc: item.upc || null,
        product_name: item.productName,
        product_image_url: item.productImageUrl,
        price_at_checkout: item.priceAtCheckout,
        promo_price: item.promoPrice,
        quantity: item.quantity,
        timestamp: item.timestamp,
        note: item.note
    }));
}