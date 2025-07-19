import { createSuccessResult, createErrorResult, validateClient } from '../utils/errorHelpers';
import { updateSessionStatus } from './CartBusinessService';
import { getCartCloneCellId } from './CartCloneService';

let client: any = null;

export function setOrdersClient(holoClient: any) {
    client = holoClient;
}

// Return order to shopping (recall order)
export async function returnToShopping() {
    const clientError = validateClient(client, 'return to shopping');
    if (clientError) return clientError;

    try {
        const cloneCellId = getCartCloneCellId();
        const result = await client.callZome({
            cell_id: cloneCellId,
            zome_name: 'cart',
            fn_name: 'recall_order',
            payload: null
        });
        
        // Update session status reactively
        await updateSessionStatus();
        
        return createSuccessResult(result);
    } catch (error) {
        console.error('Error returning to shopping:', error);
        return createErrorResult(error);
    }
}