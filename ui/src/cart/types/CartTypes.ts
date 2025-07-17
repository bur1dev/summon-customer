// Type for delivery time
export interface DeliveryTimeSlot {
    date: number; // Unix timestamp
    time_slot: string; // e.g. "2pm-4pm"
}

// Type for checkout details
export interface CheckoutDetails {
    addressHash?: string;
    deliveryInstructions?: string | null;
    deliveryTime?: DeliveryTimeSlot;
    currentStep?: number;
    address?: any; // Full address object
    formattedDeliveryTime?: { date: Date; display: string }; // Formatted time
}

// Type alias for base64-encoded action hash
export type ActionHashB64 = string;

export interface CartItem {
    productId: string;
    upc?: string;
    productName: string;
    productImageUrl?: string;
    priceAtCheckout: number; // Frozen regular price
    promoPrice?: number; // Frozen promo price (if available)
    soldBy?: string; // "UNIT" or "WEIGHT" - needed for correct increment/decrement behavior
    quantity: number;
    timestamp: number;
    addedOrder?: number; // Stable ordering field for display - never changes once set
    note?: string;
}

// Define the ProductGroup interface for decoded data
export interface DecodedProductGroup {
    products: any[];
    category: string;
    subcategory?: string;
    product_type?: string;
    additional_categorizations?: any[];
}

export interface TimeSlot {
    id: string;
    display: string;
    timestamp: number;
    slot: string;
}