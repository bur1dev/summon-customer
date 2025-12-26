let client: any = null;

export function setOrderFinderClient(holochainClient: any): void {
    client = holochainClient;
    
    // Log DNA hash for debugging
    if (client && client.appInfo) {
        client.appInfo().then((appInfo: any) => {
            const orderFinderCells = appInfo.cell_info?.order_finder;
            if (orderFinderCells && orderFinderCells.length > 0) {
                const dnaHash = orderFinderCells[0].value.cell_id[0];
                console.log('🔥 CUSTOMER DNA HASH (order_finder):', Array.from(dnaHash));
            }
        }).catch((error: any) => console.error('Error getting customer DNA hash:', error));
    }
}

// Post a customer's cart network seed to the shared order finder DNA
export async function postOrderRequest(
    customerName: string,
    cartNetworkSeed: string,
    estimatedTotal: string,
    deliveryTime: string
): Promise<string> {
    if (!client) throw new Error("Client not initialized");
    
    try {
        const orderRequest = {
            customer_pubkey: client.myPubKey,
            customer_name: customerName,
            cart_network_seed: cartNetworkSeed,
            estimated_total: estimatedTotal,
            delivery_time: deliveryTime,
            timestamp: Date.now() * 1000, // microseconds
            status: "posted"
        };
        
        const result = await client.callZome({
            role_name: 'order_finder',
            zome_name: 'order_finder',
            fn_name: 'post_order_request',
            payload: { request: orderRequest }
        });
        
        console.log(`🔍 CUSTOMER: Posted order request:`, result);
        return result; // Just return the hash directly
        
    } catch (error) {
        console.error(`🔍 CUSTOMER: Error posting order request:`, error);
        throw error;
    }
}