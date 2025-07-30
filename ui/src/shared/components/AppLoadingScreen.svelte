<script lang="ts">
  export let show: boolean = false;
  export let message: string = "Setting up catalog access...";
</script>

{#if show}
  <div class="loading-overlay">
    <div class="loading-container">
      <div class="loading-spinner">
        <div class="spinner-ring"></div>
        <div class="spinner-ring"></div>
        <div class="spinner-ring"></div>
      </div>
      
      <h2 class="loading-title">Summon</h2>
      <p class="loading-message">{message}</p>
    </div>
  </div>
{/if}

<style>
  .loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: linear-gradient(135deg, var(--primary), var(--secondary));
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-index-highest);
    animation: fadeIn var(--fade-in-duration) ease-out;
  }

  .loading-container {
    text-align: center;
    color: var(--button-text);
    animation: slideUp var(--transition-smooth) ease-out;
  }

  .loading-spinner {
    display: inline-block;
    position: relative;
    width: 80px;
    height: 80px;
    margin-bottom: var(--spacing-xxxl);
  }

  .spinner-ring {
    box-sizing: border-box;
    display: block;
    position: absolute;
    width: 64px;
    height: 64px;
    margin: var(--spacing-xs);
    border: var(--spacing-xs) solid transparent;
    border-top-color: var(--button-text);
    border-radius: 50%;
    animation: spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
  }

  .spinner-ring:nth-child(1) {
    animation-delay: -0.45s;
  }

  .spinner-ring:nth-child(2) {
    animation-delay: -0.3s;
  }

  .spinner-ring:nth-child(3) {
    animation-delay: -0.15s;
  }

  .loading-title {
    font-size: 2.5rem;
    font-weight: var(--font-weight-bold);
    margin: 0 0 var(--spacing-md) 0;
    background: linear-gradient(45deg, var(--button-text), var(--surface));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    text-shadow: var(--shadow-subtle);
  }

  .loading-message {
    font-size: var(--font-size-md);
    margin: 0;
    opacity: 0.9;
    font-weight: var(--font-weight-semibold);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(30px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

</style>