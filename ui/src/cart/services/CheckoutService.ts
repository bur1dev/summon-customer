import { callZome } from '../utils/zomeHelpers';
import { createSuccessResult, createErrorResult, validateClient } from '../utils/errorHelpers';
import { writable } from 'svelte/store';
import { getSelectedAddress } from './AddressService';
import { decode } from '@msgpack/msgpack';
import { updateSessionStatus } from './CartBusinessService';
// Functional store exports for delivery time and instructions
export const selectedDeliveryTimeSlot = writable<any>(null);
export const deliveryInstructions = writable<string>('');

let client: any = null;

// Helper function to decode session status from Holochain Record
function decodeSessionStatus(sessionStatusRecord: any): string | null {
    try {
        if (!sessionStatusRecord?.entry?.Present?.entry) {
            return null;
        }
        
        // Convert the entry bytes array to Uint8Array and decode
        const entryBytes = new Uint8Array(sessionStatusRecord.entry.Present.entry);
        const decoded = decode(entryBytes) as any;
        
        return decoded.status || null;
    } catch (error) {
        console.error('Error decoding session status:', error);
        return null;
    }
}

// Initialize services
export function setCheckoutServices(holoClient: any) {
    client = holoClient;
}

// Publish order (change session status to "Checkout")
export async function publishOrder() {
    const clientError = validateClient(client, 'publish order');
    if (clientError) return clientError;
    
    try {
        console.log('🚀 Frontend: Calling publish_order');
        const result = await callZome(client, 'cart', 'cart', 'publish_order', null);
        console.log('✅ Frontend: publish_order success:', result);
        
        // Update session status reactively
        await updateSessionStatus();
        
        return createSuccessResult(result);
    } catch (error) {
        console.error('❌ Frontend: publish_order error:', error);
        return createErrorResult(error);
    }
}


// Get complete session data (cart items, address, status, etc.)
export async function getSessionData() {
    const clientError = validateClient(client, 'get session data');
    if (clientError) return clientError;
    
    try {
        const result = await callZome(client, 'cart', 'cart', 'get_session_data', null);
        
        // Decode session status if present
        if (result.session_status) {
            const decodedStatus = decodeSessionStatus(result.session_status);
            result.session_status_decoded = decodedStatus;
        }
        
        return createSuccessResult(result);
    } catch (error) {
        console.error('Error getting session data:', error);
        return createErrorResult(error);
    }
}

// Generate delivery time slots
export function generateDeliveryTimeSlots(startDate = new Date()) {
    const slots = [
        { start: '7am', end: '9am', hour: 7 }, { start: '8am', end: '10am', hour: 8 },
        { start: '7am', end: '10am', hour: 7 }, { start: '9am', end: '11am', hour: 9 },
        { start: '8am', end: '11am', hour: 8 }, { start: '10am', end: 'Noon', hour: 10 },
        { start: '11am', end: '1pm', hour: 11 }, { start: 'Noon', end: '2pm', hour: 12 },
        { start: '1pm', end: '3pm', hour: 13 }, { start: '2pm', end: '4pm', hour: 14 },
        { start: '3pm', end: '5pm', hour: 15 }, { start: '4pm', end: '6pm', hour: 16 },
        { start: '5pm', end: '7pm', hour: 17 }, { start: '6pm', end: '8pm', hour: 18 }
    ];
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const currentHour = now.getHours();
    
    return Array.from({ length: 9 }, (_, i) => {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        date.setHours(0, 0, 0, 0);
        
        const isToday = date.getDate() === now.getDate() && 
                       date.getMonth() === now.getMonth() && 
                       date.getFullYear() === now.getFullYear();
        
        const timeSlots = slots.map((slot, index) => {
            if (isToday && slot.hour <= currentHour + 1) return null;
            
            const slotDate = new Date(date);
            slotDate.setHours(slot.hour, 0, 0, 0);
            
            return {
                id: `${i}-${index}`,
                display: `${slot.start}–${slot.end}`,
                timestamp: slotDate.getTime(),
                slot: `${slot.start}–${slot.end}`
            };
        }).filter(Boolean);
        
        return timeSlots.length > 0 ? {
            date,
            dateFormatted: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            dayOfWeek: days[date.getDay()],
            timeSlots
        } : null;
    }).filter(Boolean);
}

// Validate checkout readiness
export function validateCheckoutReadiness(): { ready: boolean; error?: string } {
    const selectedAddress = getSelectedAddress();
    
    if (!selectedAddress) {
        return { ready: false, error: "Please select a delivery address" };
    }
    
    return { ready: true };
}

// Save delivery time slot to DHT
export async function saveDeliveryTimeSlot(timeSlot: any) {
    const clientError = validateClient(client, 'save delivery time slot');
    if (clientError) return clientError;

    try {
        const deliveryTimeSlot = {
            date: timeSlot.date,       // Unix timestamp
            time_slot: timeSlot.time_slot  // e.g. "2pm-4pm"
        };

        const result = await callZome(client, 'cart', 'cart', 'set_delivery_time_slot', deliveryTimeSlot);
        return createSuccessResult(result);
    } catch (error) {
        console.error('Error saving delivery time slot:', error);
        return createErrorResult(error);
    }
}

// Save delivery instructions to DHT
export async function saveDeliveryInstructions(instructions: string) {
    const clientError = validateClient(client, 'save delivery instructions');
    if (clientError) return clientError;

    try {
        const deliveryInstructions = {
            instructions: instructions.trim(),
            timestamp: Date.now()
        };

        const result = await callZome(client, 'cart', 'cart', 'set_delivery_instructions', deliveryInstructions);
        return createSuccessResult(result);
    } catch (error) {
        console.error('Error saving delivery instructions:', error);
        return createErrorResult(error);
    }
}

// Clear checkout data
export function clearCheckoutData() {
    selectedDeliveryTimeSlot.set(null);
    deliveryInstructions.set('');
}