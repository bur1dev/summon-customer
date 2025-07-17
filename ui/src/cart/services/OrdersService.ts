import { callZome } from '../utils/zomeHelpers';
import { createSuccessResult, createErrorResult, validateClient } from '../utils/errorHelpers';
import { updateSessionStatus } from './CartBusinessService';

let client: any = null;

export function setOrdersClient(holoClient: any) {
    client = holoClient;
}

// Return order to shopping (recall order)
export async function returnToShopping() {
    const clientError = validateClient(client, 'return to shopping');
    if (clientError) return clientError;

    try {
        const result = await callZome(client, 'cart', 'cart', 'recall_order', null);
        
        // Update session status reactively
        await updateSessionStatus();
        
        return createSuccessResult(result);
    } catch (error) {
        console.error('Error returning to shopping:', error);
        return createErrorResult(error);
    }
}