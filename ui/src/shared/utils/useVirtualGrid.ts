import { tick } from 'svelte';

interface VirtualGridConfig {
    items: any[];
    itemWidth: number;
    itemHeight: number;
    containerCapacity?: number;
}

interface VirtualGridCallbacks {
    onTotalHeightChange: (height: number) => void;
    onItemsChange: (items: any[]) => void;
}

export function useVirtualGrid(config: VirtualGridConfig, callbacks: VirtualGridCallbacks) {
    let items = config.items;
    const itemWidth = config.itemWidth;
    const itemHeight = config.itemHeight;

    let gridContainer: HTMLElement | null = null;
    let parentScrollContainer: HTMLElement | null = null;

    let gridWidth = 0;
    let columnsPerRow = 1;
    let totalHeight = 0;

    let productElements = new Map<number, HTMLElement>();

    let currentVisibleIndices: number[] = [];
    let previousVisibleSet = new Set<number>();
    let renderFrameId: number | null = null;

    let boundScrollHandler: (() => void) | null = null;
    let lastDevicePixelRatio = typeof window !== "undefined" ? window.devicePixelRatio : 1;

    function updateItems(newItems: any[]) {
        items = newItems;
        previousVisibleSet.clear();
        callbacks.onItemsChange(newItems);

        if (gridContainer) {
            setTimeout(async () => {
                await tick();
                scanForElements();
                recalculateGrid();
            }, 50);
        }
    }

    function resetElements() {
        if (!gridContainer) return;

        // Clear all element positions and hide them immediately
        productElements.forEach((element) => {
            element.style.display = 'none';
            element.style.transform = '';
        });

        // Clear tracking state
        productElements.clear();
        previousVisibleSet.clear();
        currentVisibleIndices = [];

        // Force immediate element rescan and position recalculation
        setTimeout(async () => {
            await tick();
            forceElementRescan();
            recalculateGrid();
        }, 0);
    }

    function forceElementRescan() {
        if (!gridContainer) return;

        if (productElements.size !== items.length) {
            productElements.clear();
        }

        const elements = gridContainer.querySelectorAll('[data-virtual-index]');
        const elementArray = Array.from(elements) as HTMLElement[];

        elementArray.forEach((element, domIndex) => {
            element.setAttribute('data-virtual-index', domIndex.toString());
            productElements.set(domIndex, element);
        });
    }

    function recalculateGrid() {
        if (!gridContainer) return;

        setTimeout(async () => {
            if (!gridContainer) return;
            await tick();

            gridWidth = gridContainer.offsetWidth;
            columnsPerRow = Math.max(1, Math.floor(gridWidth / itemWidth));

            const rowCount = Math.ceil(items.length / columnsPerRow);
            totalHeight = rowCount * itemHeight;

            callbacks.onTotalHeightChange(totalHeight);
            calculateAndApplyPositions();
        }, 10);
    }

    function calculateAndApplyPositions() {
        if (!columnsPerRow || !gridContainer) return;
        const visibleIndices = calculateVisibleIndices();
        applyPositionsToDOM(visibleIndices);
    }

    function calculateVisibleIndices(): number[] {
        if (!gridContainer || !parentScrollContainer || !columnsPerRow) return [];

        const gridRect = gridContainer.getBoundingClientRect();
        const containerRect = parentScrollContainer.getBoundingClientRect();

        const relativeScrollTop = Math.max(
            0,
            parentScrollContainer.scrollTop -
            (gridRect.top - containerRect.top + parentScrollContainer.scrollTop),
        );

        const viewportHeight = parentScrollContainer.clientHeight;
        const startRow = Math.floor(relativeScrollTop / itemHeight);
        const visibleRows = Math.ceil(viewportHeight / itemHeight);
        const bufferRows = 4;
        const startIndex = Math.max(0, (startRow - bufferRows) * columnsPerRow);
        const endIndex = Math.min(
            items.length,
            (startRow + visibleRows + bufferRows) * columnsPerRow,
        );

        return Array.from(
            { length: endIndex - startIndex },
            (_, i) => startIndex + i
        );
    }

    function applyPositionsToDOM(visibleIndices: number[]) {
        if (!gridContainer || !columnsPerRow) return;

        const currentVisibleSet = new Set(visibleIndices);

        const cardWidth = itemWidth;
        const totalContentWidth = columnsPerRow * cardWidth;
        const remainingSpace = gridWidth - totalContentWidth;
        const gapBetweenItems = columnsPerRow > 1 ? remainingSpace / (columnsPerRow - 1) : 0;

        // Batch all DOM updates
        requestAnimationFrame(() => {
            // Show new visible elements
            for (const index of visibleIndices) {
                if (index >= items.length) continue;

                const element = productElements.get(index);
                if (element && !previousVisibleSet.has(index)) {
                    const row = Math.floor(index / columnsPerRow);
                    const col = index % columnsPerRow;
                    const leftPosition = col * (cardWidth + gapBetweenItems);
                    const topPosition = row * itemHeight;

                    element.style.display = 'block';
                    element.style.transform = `translate3d(${leftPosition}px, ${topPosition}px, 0)`;
                }
            }

            // Hide elements that are no longer visible
            for (const index of previousVisibleSet) {
                if (!currentVisibleSet.has(index)) {
                    const element = productElements.get(index);
                    if (element) element.style.display = 'none';
                }
            }

            previousVisibleSet = currentVisibleSet;
            currentVisibleIndices = visibleIndices;
        });
    }

    // SIMPLE: Fast array comparison
    function arraysChanged(newIndices: number[]): boolean {
        if (newIndices.length !== currentVisibleIndices.length) return true;
        for (let i = 0; i < newIndices.length; i++) {
            if (newIndices[i] !== currentVisibleIndices[i]) return true;
        }
        return false;
    }

    let scrollTimeout: number | null = null;

    function handleScroll() {
        if (!gridContainer || !parentScrollContainer || !columnsPerRow) return;

        // Throttle scroll updates
        if (scrollTimeout) return;

        scrollTimeout = window.setTimeout(() => {
            const visibleIndices = calculateVisibleIndices();

            if (arraysChanged(visibleIndices)) {
                applyPositionsToDOM(visibleIndices);
            }

            scrollTimeout = null;
        }, 16); // 60fps timing
    }

    function handleZoomChange() {
        // IMMEDIATE: Hide all elements first to prevent mingling
        productElements.forEach((element) => {
            element.style.display = 'none';
            element.style.transform = '';
        });
        
        // Clear state immediately
        productElements.clear();
        previousVisibleSet.clear();
        
        // Force immediate recalculation without waiting
        requestAnimationFrame(() => {
            forceElementRescan();
            recalculateGrid();
        });
    }

    function handleResize() {
        // Simple, immediate zoom detection
        if (typeof window !== "undefined") {
            const currentRatio = window.devicePixelRatio;
            if (currentRatio !== lastDevicePixelRatio) {
                lastDevicePixelRatio = currentRatio;
                // Zoom changed - reset elements immediately
                handleZoomChange();
                return; // Don't do regular resize logic
            }
        }
        
        if (gridContainer) {
            gridWidth = gridContainer.offsetWidth;
            recalculateGrid();
        }
    }

    function scanForElements() {
        forceElementRescan();
    }

    function initialize(element: HTMLElement) {
        gridContainer = element;

        parentScrollContainer = document.querySelector('.global-scroll-container') as HTMLElement;

        if (parentScrollContainer) {
            boundScrollHandler = handleScroll;
            parentScrollContainer.addEventListener('scroll', boundScrollHandler, { passive: true });
            parentScrollContainer.style.willChange = 'transform';

            setTimeout(() => {
                recalculateGrid();
                forceElementRescan();
                handleScroll();
            }, 100);
        } else {
            console.error("Global scroll container not found!");
        }

        window.addEventListener('resize', handleResize);

        setTimeout(() => {
            recalculateGrid();
            forceElementRescan();
        }, 50);

        return {
            destroy() {
                if (renderFrameId) cancelAnimationFrame(renderFrameId);

                if (parentScrollContainer && boundScrollHandler) {
                    parentScrollContainer.removeEventListener('scroll', boundScrollHandler);
                }
                window.removeEventListener('resize', handleResize);

                productElements.clear();
                previousVisibleSet.clear();
            }
        };
    }

    return {
        action: (element: HTMLElement) => initialize(element),
        updateItems,
        resetElements,
        handleZoomChange,
        scanForElements,
        recalculateGrid,
        getCurrentTotalHeight: () => totalHeight
    };
}