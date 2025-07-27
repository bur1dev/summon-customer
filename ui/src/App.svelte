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
  import { setCartServices, loadCart } from "./cart/services/CartBusinessService";
  import { setCheckoutServices } from "./cart/services/CheckoutService";
  import { setOrdersClient } from "./cart/services/OrdersService";
  import { setAddressClient } from "./cart/services/AddressService";
  import { setPreferencesClient, initializePreferencesClone } from "./products/services/PreferencesService";
  import { setCartCloneClient, initializeCartClone } from "./cart/services/CartCloneService";
  import { createProfilesStore } from "./services/ProfileService";
  import { ProfilesStore } from "@holochain-open-dev/profiles";
  import "@holochain-open-dev/profiles/dist/elements/profiles-context.js";
  import "@holochain-open-dev/profiles/dist/elements/create-profile.js";

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
  let connected = false;
  let profilesStore: ProfilesStore;
  let cloneSetupTriggered = false;  // Prevent infinite loop
  
  // Reactive profile state (only after connection + store initialization)
  $: prof = connected && profilesStore ? profilesStore.myProfile : undefined;
  
  // Trigger clone setup immediately when profile becomes complete (only once)
  $: if ($prof?.status === "complete" && $prof.value && cloneCache && !cloneSetupTriggered) {
    cloneSetupTriggered = true;
    console.log('🎯 Profile complete - triggering clone setup for proper Agent 1/2 detection');
    cloneCache.getActiveCellId().catch(err => {
      console.log('🎯 Clone setup completed with result:', err.message);
    });
  }
  
  // Loading state - connection + profiles + clone setup
  $: showLoading = !connected || 
                  $prof?.status === "pending" || 
                  $cloneSetupStore.isLoading ||
                  ($prof?.status === "complete" && $prof.value && !cloneSetupTriggered);

  // Progressive loading messages (separate from clone system)
  $: loadingMessage = !connected ? "Connecting to Holochain..." :
                     $prof?.status === "pending" ? "Loading profile..." :
                     $cloneSetupStore.isLoading ? $cloneSetupStore.message :
                     "";

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

  // Wait for Holochain to be fully ready (robust, no timeouts)
  async function waitForHolochainReady(): Promise<void> {
    let attempts = 0;
    
    while (true) {
      try {
        attempts++;
        console.log(`🔍 Checking Holochain readiness (attempt ${attempts})...`);
        
        // Check if agentPubKey is available and valid
        const appInfo = await client.appInfo();
        if (appInfo?.agent_pub_key && appInfo.agent_pub_key.length > 0) {
          console.log('✅ Holochain ready with agentPubKey:', appInfo.agent_pub_key);
          return; // Exit when actually ready
        }
        
        console.log('⏳ AgentPubKey not ready yet, retrying...');
        
      } catch (error: any) {
        console.log(`⏳ Holochain not ready yet (${error.message}), retrying...`);
      }
      
      // Brief pause between checks
      await new Promise(resolve => setTimeout(resolve, 1000));
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
    setCartCloneClient(client);
    
    console.log('✅ All service clients initialized');

    // Initialize preferences clone (simple, clean, one-time setup)
    await initializePreferencesClone();
    console.log('✅ Preferences clone ready');

    // Initialize cart clone (isolated per agent)
    await initializeCartClone();
    console.log('✅ Cart clone ready');

    // Load existing cart items from backend
    await loadCart();

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
    
    // Initialize profiles store
    profilesStore = createProfilesStore(client);
    console.log('✅ Profiles store initialized');
    
    
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

    // Wait for hc-spin to be fully ready (no arbitrary timeout)
    console.log("🚀 SUMMON: Waiting for hc-spin to initialize agentPubKey...");
    await waitForHolochainReady();

    // All setup is now handled by SimpleCloneCache when components need data
    console.log("✅ SUMMON: Connected and ready - components will handle clone setup as needed");
  });
</script>

<svelte:head>
  <link
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<!-- Loading Screen - Shows for connection + profiles + clone setup -->
<AppLoadingScreen 
  show={showLoading} 
  message={loadingMessage} 
/>

{#if connected}
<profiles-context store={profilesStore}>
  {#if $prof?.status === "complete" && !$prof.value}
    <!-- Profile creation screen - first priority -->
    <div class="profile-creation-container">
      <div class="profile-creation-content">
        <h1>Welcome to Summon!</h1>
        <p>Please create your profile to get started</p>
        <create-profile on:profile-created={() => {}}></create-profile>
      </div>
    </div>
  {:else if $prof?.status === "complete" && $prof.value}
    <!-- Main app - show after profile exists -->
    <div class="flex-scrollable-parent">
      <div class="flex-scrollable-container">
        <!-- SlideOutCart moved outside all other elements to appear at the root level -->
    <SlideOutCart
      isOpen={$isCartOpenStore}
      onClose={() => ($isCartOpenStore = false)}
      {profilesStore}
    />

    <!-- SidebarMenu with profilesStore prop -->
    <SidebarMenu {profilesStore} {client} />

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
            <HeaderContainer cartTotalValue={$cartTotal || 0} {client} />
            <div class="workspace">
              <ShopView bind:this={shopViewComponent} />
            </div>
          </div>
        {:else}
          <!-- Checked Out Carts View gets its own full container without header -->
          <div class="global-scroll-container scroll-container full-height">
            <OrdersView {profilesStore} />
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
</profiles-context>
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

  .profile-creation-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: var(--background, #f7fff7);
    padding: 20px;
  }

  .profile-creation-content {
    text-align: center;
    max-width: 400px;
    width: 100%;
  }

  .profile-creation-content h1 {
    color: var(--text-primary, #2f353a);
    margin-bottom: 10px;
    font-weight: 600;
  }

  .profile-creation-content p {
    color: var(--text-secondary, #666);
    margin-bottom: 30px;
  }
</style>