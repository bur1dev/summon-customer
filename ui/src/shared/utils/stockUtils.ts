interface Product {
    stocks_status?: string;
    name?: string;
}

interface StockInfo {
    status: 'HIGH' | 'LOW' | 'UNKNOWN';
    text: string;
    color: string;
    cssClass: string;
}

/**
 * Normalizes stock status to consistent enum values
 */
export function normalizeStatus(status: any): 'HIGH' | 'LOW' | 'UNKNOWN' {
    if (!status) return "UNKNOWN";
    const normalized = String(status).toUpperCase();
    if (normalized === "HIGH" || normalized === "IN_STOCK") return "HIGH";
    if (normalized === "LOW" || normalized === "LIMITED") return "LOW";
    return "UNKNOWN";
}

/**
 * Returns user-friendly text for stock status display
 */
export function getDisplayText(status: any): string {
    const normalizedStatus = normalizeStatus(status);
    if (normalizedStatus === "HIGH") return "Many in stock";
    if (normalizedStatus === "LOW") return "Low stock";
    return "Maybe out";
}

/**
 * Returns CSS variable color for stock status
 */
export function getStatusColor(status: any): string {
    const normalizedStatus = normalizeStatus(status);
    if (normalizedStatus === "HIGH") return "var(--success)";
    if (normalizedStatus === "LOW") return "var(--warning)";
    return "var(--error)";
}

/**
 * Returns CSS class name for stock status styling
 */
export function getCSSClass(status: any): string {
    const normalizedStatus = normalizeStatus(status);
    if (normalizedStatus === "HIGH") return "stock-high";
    if (normalizedStatus === "LOW") return "stock-low";
    return "stock-out";
}

/**
 * Gets complete stock information for UI components
 */
export function getStockInfo(product: Product): StockInfo {
    const status = normalizeStatus(product?.stocks_status);
    
    return {
        status,
        text: getDisplayText(product?.stocks_status),
        color: getStatusColor(product?.stocks_status),
        cssClass: getCSSClass(product?.stocks_status)
    };
}

/**
 * Checks if product is considered in stock (HIGH status only)
 */
export function isInStock(product: Product): boolean {
    return normalizeStatus(product?.stocks_status) === "HIGH";
}

/**
 * Checks if product has low stock
 */
export function isLowStock(product: Product): boolean {
    return normalizeStatus(product?.stocks_status) === "LOW";
}

/**
 * Checks if product stock status is unknown or out of stock
 */
export function isOutOfStock(product: Product): boolean {
    return normalizeStatus(product?.stocks_status) === "UNKNOWN";
}