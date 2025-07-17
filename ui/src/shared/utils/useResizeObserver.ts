import { tick } from 'svelte';

export interface ResizeCallbackData {
    element: HTMLElement;
    identifier?: string;
    entry: ResizeObserverEntry;
}

export interface ZoomCallbackData {
    previousZoom: number;
    currentZoom: number;
    element?: HTMLElement;
}

export interface ResizeObserverOptions {
    debounceMs?: number;
    attributeName?: string; // Attribute to extract identifier from
    requiresTick?: boolean; // Whether to await tick() before callback
    enableZoomDetection?: boolean; // Whether to monitor zoom changes
    zoomDebounceMs?: number; // Separate debounce for zoom events
}

/**
 * Enhanced ResizeObserver with zoom detection authority
 * Now handles ALL zoom logic to keep it out of scroll hot paths
 */
export function useResizeObserver(
    callback: (data: ResizeCallbackData) => void | Promise<void>,
    options: ResizeObserverOptions = {},
    zoomCallback?: (data: ZoomCallbackData) => void | Promise<void>
) {
    const {
        debounceMs = 250,
        attributeName = 'data-subcategory',
        requiresTick = false,
        enableZoomDetection = false,
        zoomDebounceMs = 300
    } = options;

    let observer: ResizeObserver | null = null;
    let timeouts = new Map<Element, number>();

    // Zoom detection state (single source of truth)
    let currentZoom = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    let zoomTimeout: number | null = null;
    let boundZoomHandlers: (() => void)[] = [];

    // Zoom detection function (centralized authority)
    const checkZoom = async (element?: HTMLElement) => {
        if (!enableZoomDetection || !zoomCallback || typeof window === "undefined") return false;

        const newZoom = window.devicePixelRatio;
        if (newZoom !== currentZoom) {
            const previousZoom = currentZoom;
            currentZoom = newZoom;

            // Debounced zoom callback
            if (zoomTimeout) clearTimeout(zoomTimeout);
            zoomTimeout = window.setTimeout(async () => {
                await zoomCallback({
                    previousZoom,
                    currentZoom: newZoom,
                    element
                });
                zoomTimeout = null;
            }, zoomDebounceMs);

            return true;
        }
        return false;
    };

    const handleResize = async (entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
            const element = entry.target as HTMLElement;

            // Clear existing timeout for this element
            const existingTimeout = timeouts.get(element);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
            }

            // Set new debounced timeout
            const timeoutId = window.setTimeout(async () => {
                if (requiresTick) {
                    await tick();
                }

                const identifier = attributeName ? element.getAttribute(attributeName) : undefined;

                await callback({
                    element,
                    identifier: identifier || undefined,
                    entry
                });

                timeouts.delete(element);
            }, debounceMs);

            timeouts.set(element, timeoutId);
        }
    };

    const createObserver = () => {
        if (!observer) {
            observer = new ResizeObserver(handleResize);
        }
        return observer;
    };

    // Setup zoom detection event listeners (centralized)
    const setupZoomDetection = () => {
        if (!enableZoomDetection || typeof window === "undefined") return;

        const handleZoomEvent = () => checkZoom();
        
        // Listen to events that can trigger zoom changes
        // NOTE: Don't use 'resize' event here as it conflicts with useVirtualGrid
        window.addEventListener('mouseup', handleZoomEvent);
        window.addEventListener('keyup', handleZoomEvent);
        // Use visualViewport API for better zoom detection
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleZoomEvent);
        }
        
        boundZoomHandlers = [
            () => window.removeEventListener('mouseup', handleZoomEvent),
            () => window.removeEventListener('keyup', handleZoomEvent),
            () => window.visualViewport?.removeEventListener('resize', handleZoomEvent)
        ];
    };

    const cleanupZoomDetection = () => {
        boundZoomHandlers.forEach(cleanup => cleanup());
        boundZoomHandlers = [];
        if (zoomTimeout) {
            clearTimeout(zoomTimeout);
            zoomTimeout = null;
        }
    };

    const observe = (element: HTMLElement) => {
        if (!element) return;
        const obs = createObserver();
        obs.observe(element);
        
        // Setup zoom detection on first observe
        if (boundZoomHandlers.length === 0) {
            setupZoomDetection();
        }
    };

    const unobserve = (element: HTMLElement) => {
        if (!element || !observer) return;

        // Clear any pending timeout for this element
        const timeout = timeouts.get(element);
        if (timeout) {
            clearTimeout(timeout);
            timeouts.delete(element);
        }

        observer.unobserve(element);
    };

    const disconnect = () => {
        if (observer) {
            observer.disconnect();
            observer = null;
        }

        // Clear all timeouts
        timeouts.forEach(timeout => clearTimeout(timeout));
        timeouts.clear();
        
        // Clean up zoom detection
        cleanupZoomDetection();
    };

    // Svelte action for use:action directive
    const action = (element: HTMLElement) => {
        if (!element) return;

        observe(element);

        return {
            destroy() {
                unobserve(element);
            }
        };
    };

    return {
        observe,
        unobserve,
        disconnect,
        action,
        // Expose zoom utilities for external use
        checkZoom: () => checkZoom(),
        getCurrentZoom: () => currentZoom
    };
}