<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import type { DeliveryTimeSlot } from "../../types/CartTypes";
    import { ChevronLeft, ChevronRight } from "lucide-svelte";
    import { clickable } from "../../../shared/actions/clickable";
    import { stopTimeSlotStagger, startTimeSlotStagger } from "../../../utils/animationUtils";

    // Event dispatcher
    const dispatch = createEventDispatcher();

    // Props
    export let timeSlots: any[];
    export let selectedDate: Date | null = null;
    export let selectedTimeSlot: any = null;
    export let isEntering = true;
    export let isExiting = false;

    // State
    let visibleStartIndex = 0;
    let visibleDays: any[] = [];
    let canScrollLeft = false;
    let canScrollRight = true;

    // Animation container
    let timeSlotContainer: HTMLElement | undefined;

    onMount(() => {
        updateVisibleDays();

        // Initialize from saved values if available
        if (selectedDate && timeSlots) {
            // Find the matching day by date
            const matchingDay = timeSlots.find(
                (day: any) => day.date.getTime() === selectedDate!.getTime(),
            );

            if (matchingDay && selectedTimeSlot) {
                // Find the matching time slot by slot value
                const matchingSlot = matchingDay.timeSlots.find(
                    (slot: any) => slot.slot === selectedTimeSlot,
                );

                if (matchingSlot) {
                    selectedTimeSlot = matchingSlot;
                }
            }
        }
    });

    // Update which days are visible in the carousel
    function updateVisibleDays() {
        // Always show 3 days starting from visibleStartIndex
        const endIdx = Math.min(timeSlots.length, visibleStartIndex + 3);
        visibleDays = timeSlots.slice(visibleStartIndex, endIdx);

        // Enable/disable scroll buttons
        canScrollLeft = visibleStartIndex > 0;
        canScrollRight = visibleStartIndex < timeSlots.length - 3;
    }

    // Handle date selection (only selects, doesn't navigate)
    function selectDate(date: Date) {
        selectedDate = date;
        selectedTimeSlot = null; // Reset time slot when date changes
        dispatchSelection();
    }

    // Handle time slot selection
    function selectTimeSlot(timeSlot: any) {
        selectedTimeSlot = timeSlot;
        dispatchSelection();
    }

    // Dispatch the selection event
    function dispatchSelection() {
        if (selectedDate && selectedTimeSlot) {
            const deliveryTime: DeliveryTimeSlot = {
                date: selectedDate.getTime(),
                time_slot: selectedTimeSlot.slot,
            };

            dispatch("select", { deliveryTime });
        }
    }

    // Scroll date carousel - only changes which days are visible
    function scrollDates(direction: string) {
        if (direction === "left" && canScrollLeft) {
            visibleStartIndex -= 1;
        } else if (direction === "right" && canScrollRight) {
            visibleStartIndex += 1;
        }

        updateVisibleDays();
    }

    // Find currently visible time slots for the selected date
    $: currentDateTimeSlots =
        timeSlots.find(
            (d: any) =>
                selectedDate && d.date.getTime() === selectedDate.getTime(),
        )?.timeSlots || [];

    // Simple animation logic
    $: if (timeSlotContainer) {
        if (isExiting) {
            stopTimeSlotStagger(timeSlotContainer);
        } else if (selectedDate && currentDateTimeSlots.length > 0) {
            timeSlotContainer.classList.remove("stagger-enter", "stagger-exit");
            startTimeSlotStagger(timeSlotContainer);
        }
    }

    // Update visible days when slots change
    $: {
        if (timeSlots) {
            updateVisibleDays();
        }
    }
</script>

<div class="delivery-time-selector">
    <div class="delivery-time-header">
        <h2
            class={isEntering
                ? "slide-in-left"
                : isExiting
                  ? "slide-out-left"
                  : ""}
        >
            Choose Delivery Time
        </h2>
    </div>

    <div
        class="date-selector {isEntering
            ? 'slide-in-left'
            : isExiting
              ? 'slide-out-left'
              : ''}"
    >
        <button
            class="scroll-button left {canScrollLeft ? '' : 'disabled'}"
            on:click={() => scrollDates("left")}
            disabled={!canScrollLeft}
        >
            <ChevronLeft size={20} />
        </button>

        <div class="date-cards-container">
            {#each visibleDays as day}
                <div
                    class="date-card {selectedDate &&
                    day.date.getTime() === selectedDate.getTime()
                        ? 'selected'
                        : ''}"
                    use:clickable={() => selectDate(day.date)}
                >
                    <div class="date-card-day">{day.dayOfWeek}</div>
                    <div class="date-card-date">{day.dateFormatted}</div>
                </div>
            {/each}
        </div>

        <button
            class="scroll-button right {canScrollRight ? '' : 'disabled'}"
            on:click={() => scrollDates("right")}
            disabled={!canScrollRight}
        >
            <ChevronRight size={20} />
        </button>
    </div>

    {#if selectedDate}
        <div
            class="time-slots-container {isEntering
                ? 'slide-in-down'
                : isExiting
                  ? 'slide-out-down'
                  : ''}"
        >
            <div class="time-slots-header">Select a delivery time</div>

            <div class="time-slots-grid" bind:this={timeSlotContainer}>
                {#each currentDateTimeSlots as timeSlot}
                    <div class="time-slot-wrapper">
                        <div
                            class="time-slot {selectedTimeSlot &&
                            (typeof selectedTimeSlot === 'string'
                                ? selectedTimeSlot === timeSlot.slot
                                : selectedTimeSlot.id === timeSlot.id)
                                ? 'selected'
                                : ''}"
                            use:clickable={() => selectTimeSlot(timeSlot)}
                        >
                            <div class="time-slot-time">{timeSlot.display}</div>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>

<style>
    .delivery-time-selector {
        background: var(--background);
        border-radius: var(--card-border-radius);
        width: 100%;
    }

    .delivery-time-header {
        height: var(--component-header-height); /* Explicit height */
        box-sizing: border-box; /* Include padding and border in the element's total width and height */
        padding: 0 var(--spacing-md); /* Adjust padding, left/right as needed */
        border-bottom: var(--border-width-thin) solid var(--border);
        background: var(--background);
        border-radius: var(--card-border-radius) var(--card-border-radius) 0 0;
        display: flex; /* To allow vertical alignment */
        align-items: center; /* Vertically center content */
    }

    .delivery-time-header h2 {
        margin: 0;
        font-size: var(--spacing-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .date-selector {
        display: flex;
        align-items: center;
        padding: var(--spacing-md);
        border-bottom: var(--border-width-thin) solid var(--border);
        position: relative;
        overflow: visible;
    }

    .date-cards-container {
        display: flex;
        flex: 1;
        justify-content: center;
        gap: var(--spacing-xs);
        overflow: visible;
        padding: 0 var(--spacing-xl);
    }

    .date-card {
        min-width: 90px;
        max-width: 100px;
        flex: 1;
        text-align: center;
        padding: var(--spacing-sm) var(--spacing-xs);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--btn-border-radius);
        cursor: pointer;
        transition: var(--btn-transition);
        background: var(--background);
    }

    .date-card:hover {
        transform: translateY(var(--hover-lift));
        border-color: var(--primary);
        box-shadow: var(--shadow-subtle);
    }

    .date-card.selected {
        border-color: var(--primary);
        background: linear-gradient(
            135deg,
            rgba(86, 98, 189, 0.1),
            rgba(112, 70, 168, 0.1)
        );
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-medium);
    }

    .date-card-day {
        font-weight: var(--font-weight-semibold);
        margin-bottom: 4px;
        font-size: var(--font-size-sm);
        color: var(--text-primary);
    }

    .date-card-date {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
    }

    .scroll-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--btn-icon-size-sm);
        height: var(--btn-icon-size-sm);
        border: none;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border-radius: 50%;
        cursor: pointer;
        transition: var(--btn-transition);
        box-shadow: var(--shadow-button);
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        z-index: var(--z-index-sticky);
        margin: 0;
    }

    .scroll-button.left {
        left: var(--spacing-xs);
    }

    .scroll-button.right {
        right: var(--spacing-xs);
    }

    .scroll-button:hover:not(.disabled) {
        transform: translateY(-50%) scale(var(--hover-scale));
        box-shadow: var(--shadow-medium);
        background: linear-gradient(
            135deg,
            var(--primary-dark),
            var(--secondary)
        );
    }

    :global(.scroll-button svg) {
        color: var(--button-text);
        stroke: var(--button-text);
    }

    .scroll-button.disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--surface);
        color: var(--text-secondary);
        border: var(--border-width-thin) solid var(--border);
        box-shadow: none;
    }

    :global(.scroll-button.disabled svg) {
        color: var(--text-secondary);
        stroke: var(--text-secondary);
    }

    .time-slots-container {
        padding: var(--spacing-md);
    }

    .time-slots-header {
        margin-bottom: var(--spacing-md);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .time-slots-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: var(--spacing-sm);
    }


    .time-slot {
        padding: var(--spacing-sm);
        border: var(--border-width-thin) solid var(--border);
        border-radius: var(--btn-border-radius);
        cursor: pointer;
        text-align: center;
        transition: var(--btn-transition);
        background: var(--background);
    }

    .time-slot:hover {
        transform: translateY(var(--hover-lift));
        border-color: var(--primary);
        box-shadow: var(--shadow-subtle);
    }

    .time-slot.selected {
        border-color: var(--primary);
        background: linear-gradient(
            135deg,
            rgba(86, 98, 189, 0.1),
            rgba(112, 70, 168, 0.1)
        );
        transform: translateY(var(--hover-lift));
        box-shadow: var(--shadow-medium);
    }

    .time-slot-time {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }
</style>
