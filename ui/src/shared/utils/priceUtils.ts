interface Product {
    price: number;
    promo_price?: number;
    sold_by?: string;
}

interface PriceCalculation {
    regular: number;
    promo: number;
    savings: number;
}

interface DisplayPrices {
    hasPromo: boolean;
    regularPrice: string;
    promoPrice?: string;
    loyaltyLabel: string;
    soloPrice?: string;
}

/**
 * Checks if product has a valid promotional price
 */
export function hasPromoPrice(product: Product): boolean {
    return !!(
        product.promo_price &&
        typeof product.promo_price === 'number' &&
        !isNaN(product.promo_price) &&
        product.promo_price > 0 &&
        product.promo_price < product.price
    );
}

/**
 * Returns the effective price to use (promo if valid, otherwise regular)
 */
export function getEffectivePrice(product: Product): number {
    return hasPromoPrice(product) ? product.promo_price! : product.price;
}

/**
 * Calculates totals for given product and quantity
 */
export function calculateItemTotal(product: Product, quantity: number): PriceCalculation {
    const regular = product.price * quantity;
    const promo = getEffectivePrice(product) * quantity;
    const savings = regular - promo;

    return {
        regular,
        promo,
        savings: savings > 0 ? savings : 0
    };
}

/**
 * Formats price with appropriate unit suffix
 */
export function formatPriceDisplay(price: number, soldBy?: string): string {
    const isSoldByWeight = soldBy === "WEIGHT";
    return `$${price.toFixed(2)}${isSoldByWeight ? "/lb" : ""}`;
}

/**
 * Formats price for unit display (used in cart items)
 */
export function formatPriceWithUnit(price: number, soldBy?: string): string {
    const isSoldByWeight = soldBy === "WEIGHT";
    return `$${price.toFixed(2)}${isSoldByWeight ? "/lb" : " each"}`;
}

/**
 * Gets complete display prices for UI components
 */
export function getDisplayPrices(product: Product): DisplayPrices {
    const hasPromo = hasPromoPrice(product);
    const isSoldByWeight = product.sold_by === "WEIGHT";

    if (hasPromo) {
        return {
            hasPromo: true,
            regularPrice: `reg. ${formatPriceDisplay(product.price, product.sold_by)}`,
            promoPrice: formatPriceDisplay(product.promo_price!, product.sold_by),
            loyaltyLabel: "With loyalty card",
            soloPrice: undefined
        };
    } else {
        return {
            hasPromo: false,
            regularPrice: "",
            promoPrice: undefined,
            loyaltyLabel: "",
            soloPrice: formatPriceDisplay(product.price, product.sold_by)
        };
    }
}

/**
 * Calculates savings between two totals
 */
export function calculateSavings(regularTotal: number, promoTotal: number): number {
    const savings = regularTotal - promoTotal;
    return savings > 0 ? savings : 0;
}

/**
 * Formats savings amount for display
 */
export function formatSavings(savings: number): string {
    return `$${savings.toFixed(2)}`;
}

/**
 * Formats total amount for display
 */
export function formatTotal(amount: number): string {
    return `$${amount.toFixed(2)}`;
}