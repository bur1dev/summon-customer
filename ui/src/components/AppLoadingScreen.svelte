<script lang="ts">
  export let show: boolean = false;
  export let message: string = "Setting up catalog access...";
  export let progress: number = 0; // 0-100
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
      
      {#if progress > 0}
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" style="width: {progress}%"></div>
          </div>
          <span class="progress-text">{progress}%</span>
        </div>
      {/if}
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
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: fadeIn 0.3s ease-out;
  }

  .loading-container {
    text-align: center;
    color: white;
    animation: slideUp 0.6s ease-out;
  }

  .loading-spinner {
    display: inline-block;
    position: relative;
    width: 80px;
    height: 80px;
    margin-bottom: 2rem;
  }

  .spinner-ring {
    box-sizing: border-box;
    display: block;
    position: absolute;
    width: 64px;
    height: 64px;
    margin: 8px;
    border: 8px solid transparent;
    border-top-color: rgba(255, 255, 255, 0.8);
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
    font-weight: 700;
    margin: 0 0 1rem 0;
    background: linear-gradient(45deg, #fff, #f0f8ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  .loading-message {
    font-size: 1.2rem;
    margin: 0 0 2rem 0;
    opacity: 0.9;
    font-weight: 400;
  }

  .progress-container {
    display: flex;
    align-items: center;
    gap: 1rem;
    max-width: 300px;
    margin: 0 auto;
  }

  .progress-bar {
    flex: 1;
    height: 8px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4ade80, #22c55e);
    border-radius: 4px;
    transition: width 0.3s ease;
    animation: pulse 2s ease-in-out infinite;
  }

  .progress-text {
    font-size: 0.9rem;
    font-weight: 600;
    min-width: 40px;
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

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }
</style>