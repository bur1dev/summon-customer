import { writable, derived, get } from 'svelte/store';
import type { CartItem } from '../types/CartTypes';
import { parseProductHash, getIncrementValue } from '../utils/cartHelpers';
import { callZome } from '../utils/zomeHelpers';
import { getSessionData } from './CheckoutService';

// Service dependencies
let client: any = null;

// Core stores
export const cartItems = writable<CartItem[]>([]);
export const cartTotal = writable(0);
export const cartPromoTotal = writable(0);
export const cartReady = writable(false);
export const cartLoading = writable(false);

// Session status store - centralized session state management
export const sessionStatus = writable<string>('Shopping');
export const isCheckoutSession = derived(sessionStatus, status => status === 'Checkout');

// Derived stores for UI
export const itemCount = derived(cartItems, items =>
    items.reduce((sum, item) => sum + item.quantity, 0)
);
export const uniqueItemCount = derived(cartItems, items => items.length);
export const hasItems = derived(cartItems, items => items.length > 0);

// Order tracking for stable cart item ordering
let nextAddedOrder = 1;

// Service initialization
export function setCartServices(holoClient: any): void {
    client = holoClient;
    // Don't automatically load cart - will be called explicitly after client is ready
}


// Load cart from backend and aggregate by productId
export async function loadCart(): Promise<void> {
    if (!client) return;
    
    cartLoading.set(true);
    
    try {
        const backendItems = await callZome(client, 'cart', 'cart', 'get_current_items', null);
        
        if (backendItems && Array.isArray(backendItems)) {
            // Convert backend format to CartItem and aggregate by productId
            const aggregated = aggregateByProductId(backendItems);
            cartItems.set(aggregated);
            calculateTotals(aggregated);
        } else {
            cartItems.set([]);
            cartTotal.set(0);
            cartPromoTotal.set(0);
        }
    } catch (error) {
        console.error('Error loading cart:', error);
        cartItems.set([]);
        cartTotal.set(0);
        cartPromoTotal.set(0);
    }
    
    cartLoading.set(false);
    cartReady.set(true);
}

// Convert backend items to CartItem format (no aggregation needed - backend now handles this)
function aggregateByProductId(backendItems: any[]): CartItem[] {
    // Keep track of existing items to preserve their addedOrder
    const currentItems = get(cartItems);
    const existingOrders = new Map(currentItems.map((item: CartItem) => [item.productId, item.addedOrder]));
    
    return backendItems.map(item => ({
        productId: item.product_id,
        upc: item.upc,
        productName: item.product_name,
        productImageUrl: item.product_image_url,
        priceAtCheckout: item.price_at_checkout || 0,
        promoPrice: item.promo_price,
        soldBy: item.sold_by || "UNIT",
        quantity: item.quantity || 1,      // Now comes directly from link tag
        timestamp: item.timestamp || Date.now(),  // Now comes directly from link tag
        addedOrder: existingOrders.get(item.product_id) ?? nextAddedOrder++  // Preserve existing order or assign new
    }));
}

// Add product to cart - OPTIMIZED: uses new add_cart_item zome function
export async function addToCart(product: any, quantity: number = 1) {
    if (!client) return { success: false, error: "Service not initialized" };
    
    try {
        const { productId } = parseProductHash(product);
        if (!productId) return { success: false, error: "Invalid product" };
        
        // Create CartProduct without quantity (quantity now in link tag)
        const cartProduct = {
            product_id: productId,
            upc: product.upc,
            product_name: product.name,
            product_image_url: product.image_url,
            price_at_checkout: product.price || 0,
            promo_price: product.promo_price,
            sold_by: product.sold_by || "UNIT",
            note: null
        };
        
        // Use optimized add_cart_item function with quantity parameter
        await callZome(client, 'cart', 'cart', 'add_cart_item', {
            product: cartProduct,
            quantity: quantity
        });
        
        await loadCart();
        return { success: true };
    } catch (error) {
        console.error('Error adding to cart:', error);
        return { success: false, error };
    }
}

// Remove specific quantity of a product from cart - OPTIMIZED: uses new remove_cart_item zome function
export async function removeSpecificQuantity(product: any, quantityToRemove: number) {
    if (!client) return { success: false, error: "Service not initialized" };
    
    try {
        const { productId } = parseProductHash(product);
        if (!productId) return { success: false, error: "Invalid product" };
        
        // Use optimized remove_cart_item function with quantity parameter
        await callZome(client, 'cart', 'cart', 'remove_cart_item', {
            product_id: productId,
            quantity: quantityToRemove
        });
        
        await loadCart();
        return { success: true };
    } catch (error) {
        console.error('Error removing specific quantity:', error);
        return { success: false, error };
    }
}

// Remove all instances of a product from cart - OPTIMIZED: removes entire quantity
export async function removeItemFromCart(product: any) {
    if (!client) return { success: false, error: "Service not initialized" };
    
    try {
        const { productId } = parseProductHash(product);
        if (!productId) return { success: false, error: "Invalid product" };
        
        // Get current quantity and remove all of it
        const backendItems = await callZome(client, 'cart', 'cart', 'get_current_items', null);
        
        if (backendItems && Array.isArray(backendItems)) {
            const item = backendItems.find(item => item.product_id === productId);
            if (item && item.quantity > 0) {
                // Remove the entire quantity using optimized function
                await callZome(client, 'cart', 'cart', 'remove_cart_item', {
                    product_id: productId,
                    quantity: item.quantity
                });
            }
        }
        
        await loadCart();
        return { success: true };
    } catch (error) {
        console.error('Error removing item:', error);
        return { success: false, error };
    }
}

// Clear cart - OPTIMIZED: removes all quantities using new function
export async function clearCart() {
    if (!client) return { success: false, error: "Service not initialized" };
    
    try {
        const backendItems = await callZome(client, 'cart', 'cart', 'get_current_items', null);
        
        if (backendItems && Array.isArray(backendItems)) {
            for (const item of backendItems) {
                if (item.quantity > 0) {
                    // Remove entire quantity using optimized function
                    await callZome(client, 'cart', 'cart', 'remove_cart_item', {
                        product_id: item.product_id,
                        quantity: item.quantity
                    });
                }
            }
        }
        
        await loadCart();
        return { success: true };
    } catch (error) {
        console.error('Error clearing cart:', error);
        return { success: false, error };
    }
}

// Calculate totals
function calculateTotals(items: CartItem[]): void {
    const regularTotal = items.reduce((sum, item) => sum + (item.priceAtCheckout * item.quantity), 0);
    const promoTotal = items.reduce((sum, item) => sum + ((item.promoPrice || item.priceAtCheckout) * item.quantity), 0);
    
    cartTotal.set(regularTotal);
    cartPromoTotal.set(promoTotal);
}

// Get current cart items
export function getCartItems(): CartItem[] {
    let items: CartItem[] = [];
    cartItems.subscribe(value => items = value)();
    return items;
}

// Subscribe to cart changes
export function subscribe(callback: (items: CartItem[]) => void) {
    return cartItems.subscribe(callback);
}

// Get client
export function getClient(): any {
    return client;
}

// Update session status from DHT data
export async function updateSessionStatus(): Promise<void> {
    if (!client) return;
    
    try {
        const result = await getSessionData();
        if (result.success && result.data.session_status_decoded) {
            sessionStatus.set(result.data.session_status_decoded);
        }
    } catch (error) {
        console.error('Error updating session status:', error);
        // Default to Shopping on error
        sessionStatus.set('Shopping');
    }
}

// Restore cart items (used by OrdersService)
export async function restoreCartItems(cart: any): Promise<void> {
    console.log("TODO: Restore cart items", cart);
}

