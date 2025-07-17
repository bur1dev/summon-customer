<script lang="ts">
  
  import ShopView from "./navigation/components/ShopView.svelte";
  import HeaderContainer from "./navigation/components/HeaderContainer.svelte";
  import { ProductDataService, setProductDataService } from "./products/services/ProductDataService";
  import { ProductRowCacheService } from "./products/services/ProductRowCacheService";
  import { SimpleCloneCache } from "./products/utils/SimpleCloneCache";
  import { BackgroundCloneManager } from "./products/utils/BackgroundCloneManager";
  import AppLoadingScreen from "./components/AppLoadingScreen.svelte";
  import { cloneSetupStore } from "./stores/LoadingStore";
  import { onMount } from "svelte";
  import {
    AppWebsocket,
    type AppClient,
  } from "@holochain/client";
  import "@shoelace-style/shoelace/dist/themes/light.css";
  import { setCartServices } from "./cart/services/CartBusinessService";
  import { setCheckoutServices } from "./cart/services/CheckoutService";
  import { setOrdersClient } from "./cart/services/OrdersService";
  import { setAddressClient } from "./cart/services/AddressService";
  import { setPreferencesClient } from "./products/services/PreferencesService";

  import CategorySidebar from "./navigation/components/CategorySidebar.svelte";
  import SlideOutCart from "./cart/components/SlideOutCart.svelte";
  import OrdersView from "./cart/orders/components/OrdersView.svelte";

  // Import from UI-only store
  import { currentViewStore, isCartOpenStore } from "./stores/UiOnlyStore";

  import SidebarMenu from "./navigation/components/SidebarMenu.svelte";
  import { cartTotal } from "./cart/services/CartBusinessService";

  // App connection constants (simplified - no admin port needed)
  // const appId = import.meta.env.VITE_APP_ID ? import.meta.env.VITE_APP_ID : "summon"; // Unused for now

  let client: AppClient;
  let shopViewComponent: ShopView;
  let cloneSystemReady = false;
  let setupMessage = "Setting up catalog access...";
  let setupProgress = 0;
  let connected = false;
  
  // Global loading state for any clone setup operations
  $: globalLoading = $cloneSetupStore.isLoading;
  $: showLoading = !connected || !cloneSystemReady || globalLoading;

  // Create ProductDataService during initialization
  // Create global cache service instance if it doesn't exist
  if (typeof window !== "undefined" && !window.productRowCache) {
    window.productRowCache = new ProductRowCacheService();
  }

  const cacheService: ProductRowCacheService =
    typeof window !== "undefined" && window.productRowCache
      ? window.productRowCache
      : new ProductRowCacheService();

  let cloneCache: SimpleCloneCache;
  let backgroundCloneManager: BackgroundCloneManager;
  let productDataService: ProductDataService;
  let uploadService: any;

  // Handle category selection from sidebar
  function handleCategorySelect(event: CustomEvent) {
    if (shopViewComponent) {
      shopViewComponent.selectCategory(
        event.detail.category,
        event.detail.subcategory,
      );
    }
  }

  // Initialize the app (simplified - following Volla Messages pattern)
  async function initialize(): Promise<void> {
    console.log("🚀 SUMMON: Starting simple client connection...");
    
    try {
      // Simple connection - hc-spin handles all authentication automatically
      client = await AppWebsocket.connect({ defaultTimeout: 30000 });
      console.log("🚀 SUMMON: Client connected successfully!");
      
      // Verify app connection and DNA availability
      const appInfo = await client.appInfo();
      if (!appInfo) {
        throw new Error('Failed to get app info');
      }
      
      console.log('✅ Connected to app:', appInfo.installed_app_id || 'unknown');
      console.log('✅ Available DNA roles:', Object.keys(appInfo.cell_info || {}));
      
      // Skip initial zome call for now - hc-spin needs more time to initialize agentPubKey
      console.log("✅ Skipping initial zome call to avoid hc-spin timing issues");
      
      // Show what DNA roles are actually available
      const availableRoles = Object.keys(appInfo.cell_info || {});
      console.log(`✅ Available DNA roles:`, availableRoles);
      
      // Don't check specific roles for now - just log what's available
      availableRoles.forEach(role => {
        console.log(`✅ Role '${role}' ready`);
      });
      
    } catch (error) {
      console.error("❌ Failed to connect to Holochain:", error);
      throw error;
    }

    // Initialize all services with functional pattern - just set clients, NO data loading
    setCartServices(client);
    setCheckoutServices(client);
    setOrdersClient(client);
    setAddressClient(client);
    setPreferencesClient(client);
    
    console.log('✅ All service clients initialized');

    // Create clone cache and background manager
    cloneCache = new SimpleCloneCache(client);
    backgroundCloneManager = new BackgroundCloneManager(client, cloneCache);
    
    // Connect cache to background manager for daily checks
    cloneCache.setBackgroundManager(backgroundCloneManager);
    
    // Create services synchronously after client is ready (talking-stickies pattern)
    const { ProductsUploadService, setUploadService } = await import('./services/DHTUploadService');
    uploadService = new ProductsUploadService(client, { client });
    
    productDataService = new ProductDataService({ client }, cacheService, cloneCache);
    
    // Set exported service instances for direct imports
    setUploadService(uploadService);
    setProductDataService(productDataService);
    
    
    // Make upload service available globally for debugging/manual upload
    (window as any).uploadService = uploadService;

    connected = true;
  }

  
  onMount(async () => {
    await initialize();

    // ===== CONSOLE TESTING - KEEP FOR DEBUGGING =====
    // Expose reset method to global window for console testing
    if (typeof window !== "undefined") {
      (window as any).resetCloneManager = () => backgroundCloneManager.resetForTesting();
      console.log('🧪 TESTING: Use window.resetCloneManager() in console to reset');
    }
    // ===== END CONSOLE TESTING =====

    // Add delay to let hc-spin fully initialize before making zome calls
    console.log("🚀 SUMMON: Waiting 5 seconds for hc-spin agentPubKey to initialize...");
    setupMessage = "Waiting for Holochain to fully initialize...";
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check if we need daily setup
    if (backgroundCloneManager.shouldRunDailySetup()) {
      setupMessage = "Checking for new catalog...";
      cloneSystemReady = false;
      
      setupProgress = 25;
      setupMessage = "Finding active catalog...";
      
      setupProgress = 50;
      setupMessage = "Preparing clone access...";
      
      const success = await backgroundCloneManager.setup();
      
      setupProgress = 100;
      setupMessage = success ? "Ready!" : "Setup failed";
      
      // No delay needed - set ready immediately
      cloneSystemReady = true;
    } else {
      // Already setup today, skip loading screen
      cloneSystemReady = true;
    }

    // DataManager no longer needed - using direct imports
    
    // Let components load their own data when they need it - no premature loading
  });
</script>

<svelte:head>
  <link
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<!-- Loading Screen - Shows for both startup and browsing setup -->
<AppLoadingScreen 
  show={showLoading} 
  message={globalLoading ? $cloneSetupStore.message : setupMessage} 
  progress={globalLoading ? $cloneSetupStore.progress : setupProgress} 
/>

{#if connected && cloneSystemReady}
<div class="flex-scrollable-parent">
  <div class="flex-scrollable-container">
    <!-- SlideOutCart moved outside all other elements to appear at the root level -->
    <SlideOutCart
      isOpen={$isCartOpenStore}
      onClose={() => ($isCartOpenStore = false)}
    />

    <!-- SidebarMenu at root level (no profile props needed) -->
    <SidebarMenu />

    <div class="app">
      <div class="wrapper">
        <!-- Add CategorySidebar here, outside the global scroll container -->
        {#if $currentViewStore === "active"}
          <div class="sidebar-container">
            <CategorySidebar on:categorySelect={handleCategorySelect} />
          </div>
        {/if}

        <!-- Conditional rendering for the main content -->
        {#if $currentViewStore === "active"}
          <!-- The global scroll container with header and shop view -->
          <div class="global-scroll-container scroll-container">
            <HeaderContainer cartTotalValue={$cartTotal || 0} />
            <div class="workspace">
              <ShopView bind:this={shopViewComponent} />
            </div>
          </div>
        {:else}
          <!-- Checked Out Carts View gets its own full container without header -->
          <div class="global-scroll-container scroll-container full-height">
            <OrdersView />
          </div>
        {/if}
      </div>

      <div class="background">
        <div class="background-overlay"></div>
        <div class="background-image"></div>
      </div>
    </div>
  </div>
</div>
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    font-family: var(
      --font-family,
      "Plus Jakarta Sans",
      -apple-system,
      BlinkMacSystemFont,
      sans-serif
    );
    background: var(--background, #f7fff7);
    color: var(--text-primary, #2f353a);
  }

  .app {
    margin: 0;
    padding-bottom: 10px;
    background-size: cover;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background-color: #fff;
    position: relative;
  }

  .background {
    position: absolute;
    z-index: 0;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .background-overlay {
    background: linear-gradient(144deg, #fcfcfc 0%, rgb(255, 255, 255) 100%);
    position: absolute;
    z-index: 2;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    opacity: 0.4;
  }

  .background-image {
    position: absolute;
    z-index: 1;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    background-size: cover;
  }

  :global(:root) {
    --resizeable-height: 200px;
    --tab-width: 60px;
  }

  @media (min-width: 640px) {
    .app {
      max-width: none;
    }
  }

  .flex-scrollable-parent {
    position: relative;
    display: flex;
    flex: 1;
  }
  .flex-scrollable-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }

  .wrapper {
    position: relative;
    z-index: 10;
    height: 100%;
  }

  .global-scroll-container {
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    z-index: 0;
  }

  .global-scroll-container::-webkit-scrollbar {
    width: 10px;
    background-color: transparent;
  }

  .global-scroll-container::-webkit-scrollbar-thumb {
    height: 5px;
    border-radius: 5px;
    background: rgb(255, 255, 255);
    opacity: 1;
    width: 8px;
  }

  /* Workspace no longer needs padding-top since header scrolls with content */
  .workspace {
    padding-top: 0;
  }

  .sidebar-container {
    position: fixed;
    top: var(--component-header-height);
    left: 0;
    height: calc(100vh - var(--component-header-height));
    z-index: var(--z-index-sticky);
  }

  .full-height {
    height: 100vh;
  }
</style>