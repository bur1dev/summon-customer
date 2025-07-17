// CSS timing constants (matches app.css variables)
const TRANSITION_FAST = 200;
const TRANSITION_NORMAL = 300;
const TRANSITION_SMOOTH = 500;

/**
 * Gets animation duration for a specific animation type
 * Used in SlideOutCart.svelte and CheckoutFlow.svelte
 */
export function getAnimationDuration(type: 'fast' | 'normal' | 'smooth'): number {
    switch (type) {
        case 'fast':
            return TRANSITION_FAST;
        case 'normal':
            return TRANSITION_NORMAL;
        case 'smooth':
            return TRANSITION_SMOOTH;
        default:
            return TRANSITION_NORMAL;
    }
}

/**
 * Slides out a panel (cart or sidebar) with proper animation timing
 * Used in SidebarMenu.svelte
 */
export async function slideOutPanel(
    element: HTMLElement,
    direction: 'left' | 'right'
): Promise<void> {
    if (!element) {
        throw new Error('Element is required for slideOutPanel animation');
    }

    // Add the slide-out animation class
    element.classList.add(`slide-out-${direction}`);

    // Wait for animation to complete using smooth timing
    return new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve();
        }, TRANSITION_SMOOTH);
    });
}

/**
 * Professional zipper animation - pure CSS approach
 * Add class to container, CSS handles the rest
 */
export function startCartZipper(container: HTMLElement): void {
    if (container) {
        container.classList.add('zipper-enter');
    }
}

export function stopCartZipper(container: HTMLElement): void {
    if (container) {
        // Remove any existing animation classes first to ensure animation retriggers
        container.classList.remove('zipper-enter', 'zipper-exit');
        // Force reflow to ensure the browser registers the class removal
        void container.offsetHeight;
        // Now add the exit class
        container.classList.add('zipper-exit');
    }
}

/**
 * Time slot stagger animation - dynamic infinite elements
 */
export function startTimeSlotStagger(container: HTMLElement): void {
    if (container) {
        // Set dynamic index for each time slot wrapper
        const timeSlots = container.querySelectorAll('.time-slot-wrapper');
        timeSlots.forEach((slot, index) => {
            (slot as HTMLElement).style.setProperty('--stagger-index', index.toString());
        });
        container.classList.add('stagger-enter');
    }
}

export function stopTimeSlotStagger(container: HTMLElement): void {
    if (container) {
        // Set reverse index for exit animation
        const timeSlots = container.querySelectorAll('.time-slot-wrapper');
        const totalSlots = timeSlots.length;
        timeSlots.forEach((slot, index) => {
            const reverseIndex = totalSlots - 1 - index;
            (slot as HTMLElement).style.setProperty('--stagger-index', reverseIndex.toString());
        });
        container.classList.add('stagger-exit');
    }
}

/**
 * Item removal animation - smooth fade out with height collapse
 */
export function startItemRemoval(element: HTMLElement): Promise<void> {
    element.classList.add('item-removing');
    return new Promise(resolve => {
        setTimeout(resolve, TRANSITION_SMOOTH); // 500ms for smooth removal with height collapse
    });
}