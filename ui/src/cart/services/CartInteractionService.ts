import { addToCart, removeItemFromCart, removeSpecificQuantity, getCartItems } from './CartBusinessService';
import { getIncrementValue, parseProductHash } from '../utils/cartHelpers';

/**
 * Centralized cart interaction utilities to eliminate duplicated cart logic
 * Updated to work with the new CartItem structure using product snapshots
 */

/**
 * Adds a product to cart with default quantity (1)
 * Updated to use full product object instead of hash references
 */
export async function addProductToCart(
    product: any
): Promise<boolean> {
    try {
        const result = await addToCart(product, 1);
        return result.success;
    } catch (error) {
        console.error("Error adding to cart:", error);
        return false;
    }
}

/**
 * Increments item quantity using product-specific increment value
 */
export async function incrementItem(
    product: any,
    _currentQuantity: number
): Promise<boolean> {
    try {
        const incrementValue = getIncrementValue(product);
        // ADD individual entries, don't create entry with total quantity
        const result = await addToCart(product, incrementValue);
        return result.success;
    } catch (error) {
        console.error("Error incrementing item:", error);
        return false;
    }
}

/**
 * Decrements item quantity using product-specific increment value
 * Removes item if quantity would be 0 or negative
 */
export async function decrementItem(
    product: any,
    currentQuantity: number
): Promise<boolean> {
    try {
        const incrementValue = getIncrementValue(product);
        const newQuantity = currentQuantity - incrementValue;
        
        if (newQuantity <= 0) {
            // Remove all entries for this product
            const result = await removeItemFromCart(product);
            return result.success;
        } else {
            // Remove some individual entries (equal to incrementValue)
            const result = await removeSpecificQuantity(product, incrementValue);
            return result.success;
        }
    } catch (error) {
        console.error("Error decrementing item:", error);
        return false;
    }
}

/**
 * Removes item completely from cart
 */
export async function removeItem(product: any): Promise<boolean> {
    try {
        const result = await removeItemFromCart(product);
        return result.success;
    } catch (error) {
        console.error("Error removing item:", error);
        return false;
    }
}

/**
 * Updates item quantity to a specific value
 */
export async function updateQuantity(
    product: any,
    newQuantity: number
): Promise<boolean> {
    try {
        if (newQuantity <= 0) {
            // Remove all entries
            const result = await removeItemFromCart(product);
            return result.success;
        }
        
        // Get current quantity from aggregated cart
        const currentItems = getCartItems();
        const currentItem = currentItems.find(item => item.upc === product.upc);
        const currentQuantity = currentItem ? currentItem.quantity : 0;
        
        if (newQuantity > currentQuantity) {
            // Add the difference
            const quantityToAdd = newQuantity - currentQuantity;
            const result = await addToCart(product, quantityToAdd);
            return result.success;
        } else if (newQuantity < currentQuantity) {
            // Remove the difference  
            const quantityToRemove = currentQuantity - newQuantity;
            const result = await removeSpecificQuantity(product, quantityToRemove);
            return result.success;
        }
        
        // If newQuantity === currentQuantity, do nothing
        return true;
    } catch (error) {
        console.error("Error updating quantity:", error);
        return false;
    }
}

