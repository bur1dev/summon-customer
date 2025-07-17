<script lang="ts">
  import { Plus, Minus, Flag } from "lucide-svelte";
  import { clickable } from "../../shared/actions/clickable";
  import { formatQuantityDisplay } from "../../cart/utils/cartHelpers";

  export let product: any;
  export let displayAmount: number;
  export let onAdd: (e: MouseEvent | CustomEvent) => void;
  export let onIncrement: () => Promise<void>;
  export let onDecrement: () => Promise<void>;
  export let onReport: (e: MouseEvent) => void;
</script>

<button
  class="add-btn btn {displayAmount > 0
    ? 'counter-btn-group expanded'
    : 'btn-icon btn-icon-primary'}"
  on:click={onAdd}
>
  {#if displayAmount > 0}
    <span
      class="minus counter-btn"
      aria-label="Decrease quantity"
      use:clickable={{ handler: onDecrement, stopPropagation: true }}
    >
      <Minus size={20} color="white" />
    </span>
    <span
      class="count counter-value"
      aria-label="Current quantity"
    >
      {formatQuantityDisplay(displayAmount, product)}
    </span>
    <span
      class="plus counter-btn"
      aria-label="Increase quantity"
      use:clickable={{ handler: onIncrement, stopPropagation: true }}
    >
      <Plus size={20} color="white" />
    </span>
  {:else}
    <span class="plus-icon">
      <Plus size={20} color="white" />
    </span>
  {/if}
</button>

<button
  class="report-btn btn btn-icon-sm"
  on:click|stopPropagation={onReport}
  title="Report incorrect category"
>
  <Flag size={16} />
</button>

<style>
  .add-btn {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 10;
  }

  .add-btn.expanded {
    width: 170px;
    border-radius: 30px;
  }

  .plus-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .add-btn.expanded {
    width: 180px;
    border-radius: 30px;
    display: flex;
    justify-content: space-between;
    padding: 0;
    overflow: hidden;
    border: none;
    background: linear-gradient(135deg, var(--primary), var(--secondary));
  }

  .minus,
  .plus {
    cursor: pointer;
    width: var(--btn-height-md);
    height: var(--btn-height-md);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: var(--btn-transition);
    background-color: rgba(0, 0, 0, 0.15);
  }

  .minus:hover,
  .plus:hover {
    background-color: rgba(0, 0, 0, 0.3);
  }

  :global(.minus svg),
  :global(.plus svg),
  :global(.plus-icon svg) {
    color: var(--button-text);
    stroke: var(--button-text);
  }

  .count {
    margin: 0;
    white-space: nowrap;
    color: var(--button-text);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 0 5px;
    min-width: 60px;
    font-size: var(--font-size-md);
  }

  .report-btn {
    position: absolute;
    top: var(--spacing-sm);
    left: var(--spacing-sm);
    font-size: var(--font-size-md);
    opacity: 0.6;
    z-index: 10;
    transition: opacity var(--transition-fast);
    background-color: transparent;
  }

  .report-btn:hover {
    opacity: 1;
  }
</style>