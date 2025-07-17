// ui/src/actions/clickable.ts

interface ClickableOptions {
    handler: (event?: Event) => void;
    stopPropagation?: boolean;
    preventDefault?: boolean;
    disabled?: boolean;
}

/**
 * Svelte action that makes an element properly clickable with keyboard support.
 * Handles both click and keyboard (Enter/Space) events for accessibility.
 * 
 * Usage:
 *   <div use:clickable={handleClick}>Click me</div>
 *   <div use:clickable={{ handler: handleClick, stopPropagation: true }}>Click me</div>
 */
export function clickable(node: HTMLElement, options: ClickableOptions | (() => void)) {
    // Support both simple function and options object
    let config: ClickableOptions;
    
    if (typeof options === 'function') {
        config = { handler: options };
    } else {
        config = options;
    }

    function handleClick(event: MouseEvent) {
        if (config.disabled) return;
        
        if (config.stopPropagation) {
            event.stopPropagation();
        }
        if (config.preventDefault) {
            event.preventDefault();
        }
        
        config.handler(event);
    }

    function handleKeydown(event: KeyboardEvent) {
        if (config.disabled) return;
        
        if (event.key === 'Enter' || event.key === ' ') {
            if (config.preventDefault) {
                event.preventDefault();
            }
            if (config.stopPropagation) {
                event.stopPropagation();
            }
            
            config.handler(event);
        }
    }

    // Add proper ARIA attributes if not already present
    if (!node.hasAttribute('role')) {
        node.setAttribute('role', 'button');
    }
    if (!node.hasAttribute('tabindex')) {
        node.setAttribute('tabindex', '0');
    }

    // Attach event listeners
    node.addEventListener('click', handleClick);
    node.addEventListener('keydown', handleKeydown);

    return {
        // Update function for reactive options
        update(newOptions: ClickableOptions | (() => void)) {
            if (typeof newOptions === 'function') {
                config = { handler: newOptions };
            } else {
                config = newOptions;
            }
        },
        
        // Cleanup function
        destroy() {
            node.removeEventListener('click', handleClick);
            node.removeEventListener('keydown', handleKeydown);
        }
    };
}