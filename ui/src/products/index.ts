// Products feature exports
export { ProductDataService } from './services/ProductDataService';
export { ProductRowCacheService } from './services/ProductRowCacheService';
export * from './services/PreferencesService';

export * from './utils/categoryData';

// Main product components
export { default as ProductCard } from './components/ProductCard.svelte';
export { default as ProductRow } from './components/ProductRow.svelte';
export { default as ProductBrowserData } from './components/ProductBrowserData.svelte';
export { default as ProductBrowserView } from './components/ProductBrowserView.svelte';
export { default as AllProductsGrid } from './components/AllProductsGrid.svelte';

// Product modal components
export { default as ProductDetailModal } from './components/modal/ProductDetailModal.svelte';
export { default as ProductModalHeader } from './components/modal/ProductModalHeader.svelte';
export { default as ProductImage } from './components/modal/ProductImage.svelte';
export { default as ProductInfo } from './components/modal/ProductInfo.svelte';
export { default as ProductPricing } from './components/modal/ProductPricing.svelte';
export { default as QuantityControls } from './components/modal/QuantityControls.svelte';
export { default as PreferencesSection } from './components/modal/PreferencesSection.svelte';