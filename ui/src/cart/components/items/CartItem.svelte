<svelte:options accessors/>

<script lang="ts">
    export let id: string;
    let className: string = '';
    export { className as class };
    
    export let element: HTMLElement | undefined = undefined;
</script>

<div bind:this={element} class="cart-item {className}" {id}>
    <slot />
</div>

<style>
    .cart-item {
        display: flex;
        padding: var(--spacing-sm) 0;
        border-bottom: 1px solid var(--border);
        position: relative;
        transition: var(--btn-transition);
    }
</style>
