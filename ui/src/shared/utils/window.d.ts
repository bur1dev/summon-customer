// Add type definition for the global cache instance

import { ProductRowCacheService } from './ProductRowCacheService';

declare global {
    interface Window {
        productRowCache?: ProductRowCacheService;
        allProductsData?: any[];
    }
}