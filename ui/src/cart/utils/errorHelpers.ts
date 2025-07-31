/**
 * Service utilities for cart operations
 */

export interface ServiceResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export function createSuccessResult<T>(data?: T): ServiceResult<T> {
    return { success: true, data };
}

export function createErrorResult(error: any): ServiceResult {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage, message: errorMessage };
}

export function validateClient(client: any, operation: string): ServiceResult | null {
    if (!client) {
        const error = `No Holochain client available for ${operation}`;
        console.error(error);
        return createErrorResult(error);
    }
    return null;
}