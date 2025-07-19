import type { CellId } from '@holochain/client';
import { encodeHashToBase64 } from '@holochain/client';

let client: any = null;
let cloneCellId: CellId | null = null;

export function setCartCloneClient(holochainClient: any): void {
    client = holochainClient;
}

export async function initializeCartClone(): Promise<void> {
    if (!client) throw new Error("Client not initialized");
    if (cloneCellId) return;

    const agentPubKeyB64 = encodeHashToBase64(client.myPubKey);
    const appInfo = await client.appInfo();
    const clones = appInfo.cell_info["cart"] || [];
    
    const existingClone = clones.find((cell: any) => cell.type === "cloned");

    if (existingClone) {
        cloneCellId = existingClone.value.cell_id;
        console.log(`🛒 Using existing cart clone: ${encodeHashToBase64(cloneCellId![0])}`);
    } else {
        const clone = await client.createCloneCell({
            modifiers: { network_seed: agentPubKeyB64 },
            name: `cart-${agentPubKeyB64.slice(0, 8)}`,
            role_name: "cart"
        });
        cloneCellId = clone.cell_id;
        console.log(`🛒 Created new cart clone: ${encodeHashToBase64(cloneCellId![0])}`);
    }
}

export function getCartCloneCellId(): CellId | null {
    return cloneCellId;
}

export function isCartCloneReady(): boolean {
    return cloneCellId !== null;
}