import { encodeHash, decodeHash, callZome } from '../utils/zomeHelpers';
import { createSuccessResult, createErrorResult, validateClient } from '../utils/errorHelpers';
import { writable, get } from 'svelte/store';

// Type for Address object
export interface Address {
    street: string;
    unit?: string | null;
    city: string;
    state: string;
    zip: string;
    lat: number;
    lng: number;
    is_default: boolean;
    label?: string | null;
}

// Type alias for base64-encoded action hash
type ActionHashB64 = string;

// Type for the addresses map
type AddressMap = Record<ActionHashB64, Address>;

// ========================================================================
// PRIVATE ADDRESSES (profiles.dna) - Personal address book
// ========================================================================

export const addresses = writable<AddressMap>({});
export const addressesLoading = writable<boolean>(false);

// ========================================================================
// PUBLIC ADDRESSES (cart.dna) - Current cart delivery address
// ========================================================================

export const selectedCartAddress = writable<Address | null>(null);
export const selectedCartAddressHash = writable<string | null>(null);

let client: any = null;

// ========================================================================
// INITIALIZATION
// ========================================================================

export function setAddressClient(holoClient: any) {
    client = holoClient;
}

// Compatibility alias for cart address initialization
export function setCartAddressClient(holoClient: any) {
    setAddressClient(holoClient);
}

// ========================================================================
// PRIVATE ADDRESS OPERATIONS (profiles.dna)
// These functions manage the user's personal address book
// ========================================================================

// Load private addresses from profiles.dna
export async function loadAddresses() {
    const clientError = validateClient(client, 'loadAddresses');
    if (clientError) return;
    
    addressesLoading.set(true);
    try {
        const result = await callZome(client, 'profiles_role', 'address', 'get_addresses', null);

        if (Array.isArray(result)) {
            const addressMap: AddressMap = {};
            result.forEach(([hash, address]) => {
                addressMap[encodeHash(hash)] = address;
            });
            addresses.set(addressMap);
        }
    } finally {
        addressesLoading.set(false);
    }
}

// Create private address in profiles.dna
export async function createAddress(address: Address) {
    const clientError = validateClient(client, 'createAddress');
    if (clientError) return clientError;
    
    console.log('🏠 FRONTEND: Creating PRIVATE address in profiles.dna:', `${address.street}, ${address.city}, ${address.state}`);
    
    try {
        const result = await callZome(client, 'profiles_role', 'address', 'create_address', address);
        const hashB64 = encodeHash(result);
        addresses.update(current => ({ ...current, [hashB64]: address }));
        
        console.log('✅ FRONTEND: Private address created successfully with hash:', hashB64);
        
        if (address.is_default) {
            updateDefaultAddress(hashB64);
        }

        return createSuccessResult({ hash: hashB64 });
    } catch (error) {
        return createErrorResult(error);
    }
}

// Update private address in profiles.dna
export async function updateAddress(hashB64: ActionHashB64, address: Address) {
    const clientError = validateClient(client, 'updateAddress');
    if (clientError) return clientError;
    
    try {
        await callZome(client, 'profiles_role', 'address', 'update_address', [decodeHash(hashB64), address]);
        addresses.update(current => ({ ...current, [hashB64]: address }));
        
        if (address.is_default) {
            updateDefaultAddress(hashB64);
        }

        return createSuccessResult();
    } catch (error) {
        return createErrorResult(error);
    }
}

// Delete private address from profiles.dna
export async function deleteAddress(hashB64: ActionHashB64) {
    const clientError = validateClient(client, 'deleteAddress');
    if (clientError) return clientError;
    
    console.log('🗑️ FRONTEND: Deleting PRIVATE address from profiles.dna with hash:', hashB64);
    
    try {
        await callZome(client, 'profiles_role', 'address', 'delete_address', decodeHash(hashB64));

        console.log('✅ FRONTEND: Private address deleted successfully from profiles.dna');
        
        addresses.update(current => {
            const { [hashB64]: deleted, ...remaining } = current;
            return remaining;
        });

        return createSuccessResult();
    } catch (error) {
        return createErrorResult(error);
    }
}

// Get private address (for compatibility)
export function getAddress(hashB64: ActionHashB64) {
    return get(addresses)[hashB64];
}

// Helper to update default address in private address book
function updateDefaultAddress(defaultHashB64: ActionHashB64) {
    addresses.update(current => {
        const updated = { ...current };
        Object.keys(updated).forEach(hash => {
            if (hash !== defaultHashB64 && updated[hash].is_default) {
                updated[hash] = { ...updated[hash], is_default: false };
            }
        });
        return updated;
    });
}

// ========================================================================
// PUBLIC ADDRESS OPERATIONS (cart.dna)
// These functions manage the current cart's delivery address
// ========================================================================

// Set delivery address for the first time in the cart session (PUBLIC)
export async function setDeliveryAddress(address: Address) {
    const clientError = validateClient(client, 'setDeliveryAddress');
    if (clientError) return clientError;
    
    console.log('🛒 FRONTEND: Setting PUBLIC address in cart.dna (first time):', `${address.street}, ${address.city}, ${address.state}`);
    
    try {
        const result = await callZome(client, 'cart', 'cart', 'set_delivery_address', address);
        
        console.log('✅ FRONTEND: Public address set successfully with hash:', result);
        
        // Update local state
        selectedCartAddress.set(address);
        selectedCartAddressHash.set(result);
        
        return createSuccessResult({ hash: result });
    } catch (error) {
        return createErrorResult(error);
    }
}

// Update delivery address in the cart session (PUBLIC)
export async function updateDeliveryAddress(previousHashB64: string, newAddress: Address) {
    const clientError = validateClient(client, 'updateDeliveryAddress');
    if (clientError) return clientError;
    
    console.log('🔄 FRONTEND: Updating PUBLIC address in cart.dna from hash:', previousHashB64, 'to:', `${newAddress.street}, ${newAddress.city}, ${newAddress.state}`);
    
    try {
        // Create input struct for backend
        const input = {
            previous_address_hash: previousHashB64,
            new_address: newAddress
        };
        
        const result = await callZome(client, 'cart', 'cart', 'update_delivery_address', input);
        
        console.log('✅ FRONTEND: Public address updated successfully with new hash:', result);
        
        // Update local state
        selectedCartAddress.set(newAddress);
        selectedCartAddressHash.set(result);
        
        return createSuccessResult({ hash: result });
    } catch (error) {
        return createErrorResult(error);
    }
}

// Get current cart session data including address (PUBLIC)
export async function getCartSessionData() {
    const clientError = validateClient(client, 'getSessionData');
    if (clientError) return clientError;
    
    try {
        const result = await callZome(client, 'cart', 'cart', 'get_session_data', null);
        
        // Update local state if address exists
        if (result.address) {
            // Extract address data from Record
            const addressData = result.address.entry;
            selectedCartAddress.set(addressData);
            selectedCartAddressHash.set(result.address.action_hash);
        }
        
        return createSuccessResult(result);
    } catch (error) {
        return createErrorResult(error);
    }
}

// Clear selected cart address (PUBLIC)
export function clearSelectedAddress() {
    selectedCartAddress.set(null);
    selectedCartAddressHash.set(null);
}

// Get current selected cart address (PUBLIC)
export function getSelectedAddress(): Address | null {
    return get(selectedCartAddress);
}

// Get current selected cart address hash (PUBLIC)
export function getSelectedAddressHash(): string | null {
    return get(selectedCartAddressHash);
}

// ========================================================================
// SHARED UTILITIES
// These functions work with both private and public addresses
// ========================================================================

// Validate address using OpenStreetMap
export async function validateAddress(address: Address) {
    try {
        const query = encodeURIComponent(`${address.street}, ${address.city}, ${address.state} ${address.zip}`);
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${query}&addressdetails=1`,
            { headers: { 'Accept': 'application/json', 'User-Agent': 'SummonGrocery/1.0' } }
        );

        const data = await response.json();
        if (!data?.length) return { valid: false, message: 'Address could not be validated.' };

        const { lat: latStr, lon: lngStr } = data[0];
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        
        // Distance to Ralphs Encinitas - inline calculation
        const toRad = (deg: number) => deg * (Math.PI / 180);
        const R = 3958.8;
        const dLat = toRad(33.0382 - lat);
        const dLng = toRad(-117.2613 - lng);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(33.0382)) * Math.sin(dLng / 2) ** 2;
        const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        
        return distance <= 3 
            ? { valid: true, lat, lng }
            : { valid: false, lat, lng, message: `Address is ${distance.toFixed(1)} miles away. We only deliver within 3 miles.` };
    } catch {
        return { valid: false, message: 'Error validating address.' };
    }
}