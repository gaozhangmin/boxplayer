<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    isLivePlayback: boolean;
    volume: number;
    formatTime: (seconds: number) => string;
    badges: string[];
    passthroughActive: boolean;
    playbackDisabled?: boolean;
    playbackDisabledReason?: string;
    navigationDisabled?: boolean;
    navigationDisabledReason?: string;
    volumeDisabled?: boolean;
    volumeDisabledReason?: string;
    muteDisabled?: boolean;
    muteDisabledReason?: string;
}>();

const emit = defineEmits<{
    (e: "prev-track"): void;
    (e: "toggle-play-pause"): void;
    (e: "stop-playback"): void;
    (e: "next-track"): void;
    (e: "set-volume", volume: number): void;
    (e: "toggle-muted"): void;
}>();

const volumePercent = computed(() => Math.max(0, Math.min(100, props.volume)));
const volumeIconPath = computed(() => {
    if (volumePercent.value <= 0) {
        return "M792-56 671-177q-25 16-53 27.5T560-131v-82q14-5 27.5-10t25.5-12L480-368v208L280-360H120v-240h128L56-792l56-56 736 736-56 56Zm-8-232-58-58q17-31 25.5-65t8.5-70q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 53-14.5 102T784-288ZM650-422l-90-90v-130q47 22 73.5 66t26.5 96q0 15-2.5 29.5T650-422ZM480-592 376-696l104-104v208Zm-80 238v-94l-72-72H200v80h114l86 86Zm-36-130Z";
    }
    return "M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z";
});

const onVolumeInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    emit("set-volume", Number(input.value));
};
</script>

<template>
    <div class="controls-left">
        <button
            class="icon-button icon-button--player icon-button--lg"
            :disabled="props.navigationDisabled"
            :aria-description="props.navigationDisabledReason"
            :data-disabled-reason="props.navigationDisabled ? props.navigationDisabledReason : undefined"
            @click="emit('prev-track')"
            :title="props.navigationDisabledReason || 'Previous'"
        >
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18V6h2v12H6zm3.5-6 8.5 6V6l-8.5 6z" />
            </svg>
        </button>
        <button
            class="icon-button icon-button--player icon-button--lg"
            :disabled="props.playbackDisabled"
            :aria-description="props.playbackDisabledReason"
            :data-disabled-reason="props.playbackDisabled ? props.playbackDisabledReason : undefined"
            :title="
                props.playbackDisabledReason || (isPlaying ? 'Pause' : 'Play')
            "
            @click="emit('toggle-play-pause')"
        >
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path
                    v-if="!isPlaying"
                    d="M8,5.14V19.14L19,12.14L8,5.14Z"
                />
                <path v-else d="M14,19H18V5H14M6,19H10V5H6V19Z" />
            </svg>
        </button>
        <button
            class="icon-button icon-button--player icon-button--lg"
            :disabled="props.navigationDisabled"
            :aria-description="props.navigationDisabledReason"
            :data-disabled-reason="props.navigationDisabled ? props.navigationDisabledReason : undefined"
            @click="emit('next-track')"
            :title="props.navigationDisabledReason || 'Next'"
        >
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 6v12h2V6h-2zm-1.5 6L6 18V6l8.5 6z" />
            </svg>
        </button>
        <div
            v-if="passthroughActive"
            class="passthrough-indicator"
            role="img"
            aria-label="Audio passthrough active. Volume is controlled by the receiver."
            title="Audio passthrough active · Volume controlled by receiver"
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 9v6h4l5 5V4L7 9H3Zm2 2h2.83L10 8.83v6.34L7.83 13H5v-2Z" />
                <circle cx="15" cy="12" r="1" />
                <circle cx="18" cy="12" r="1" />
                <circle cx="21" cy="12" r="1" />
            </svg>
        </div>
        <div
            v-else
            class="volume-control"
            :class="{ 'volume-control--disabled': props.volumeDisabled }"
            :style="{ '--volume-percent': `${volumePercent}%` }"
            :data-disabled-reason="props.volumeDisabled ? props.volumeDisabledReason : undefined"
            :title="props.volumeDisabledReason"
        >
            <button
                class="icon-button icon-button--player volume-control__button"
                :disabled="props.volumeDisabled || props.muteDisabled"
                :aria-disabled="props.volumeDisabled || props.muteDisabled"
                :aria-description="props.volumeDisabledReason || props.muteDisabledReason"
                :data-disabled-reason="
                    props.volumeDisabled || props.muteDisabled
                        ? props.volumeDisabledReason || props.muteDisabledReason
                        : undefined
                "
                :title="
                    props.volumeDisabledReason || props.muteDisabledReason ||
                    (volumePercent > 0
                        ? `Mute volume ${volumePercent}%`
                        : 'Restore volume')
                "
                @click="emit('toggle-muted')"
            >
                <svg viewBox="0 -960 960 960" fill="currentColor">
                    <path :d="volumeIconPath" />
                </svg>
            </button>
            <div class="volume-control__popover">
                <input
                    class="volume-control__slider"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    :value="volumePercent"
                    :aria-label="`Volume ${volumePercent}%`"
                    :aria-description="props.volumeDisabledReason"
                    :disabled="props.volumeDisabled"
                    @input="onVolumeInput"
                />
            </div>
        </div>
        <div v-if="isLivePlayback" class="time-display time-display--live">
            <span class="live-dot" aria-hidden="true"></span>
            <span>Live</span>
        </div>
        <div v-else class="time-display">
            <span>{{ formatTime(currentTime) }}</span>
            <span class="separator">/</span>
            <span>{{ formatTime(duration) }}</span>
        </div>
        <div v-if="props.badges.length" class="status-badges">
            <span
                v-for="badge in props.badges"
                :key="badge"
                class="status-badge"
            >
                {{ badge }}
            </span>
        </div>
    </div>
</template>

<style scoped>
.volume-control {
    --volume-percent: 100%;
    position: relative;
    display: flex;
    align-items: center;
    border-radius: 8px;
    padding: 2px;
}

.volume-control--disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.volume-control--disabled .volume-control__popover {
    display: none;
}

.volume-control--disabled[data-disabled-reason]:hover::after {
    content: attr(data-disabled-reason);
    position: absolute;
    z-index: 3;
    bottom: calc(100% + 8px);
    left: 50%;
    width: max-content;
    max-width: min(260px, 70vw);
    padding: 6px 8px;
    border-radius: 5px;
    color: rgba(255, 255, 255, 0.94);
    background: rgba(16, 22, 30, 0.94);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    font-size: 11px;
    line-height: 1.35;
    pointer-events: none;
    transform: translateX(-50%);
}

.volume-control:hover,
.volume-control:focus-within {
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.volume-control__button {
    width: 32px;
    height: 32px;
    border-radius: 6px;
}

.volume-control__button svg {
    width: 22px;
    height: 22px;
}

.passthrough-indicator {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.92);
}

.passthrough-indicator svg {
    width: 23px;
    height: 23px;
}

.passthrough-indicator path,
.passthrough-indicator circle {
    fill: currentColor;
}

.volume-control__popover {
    position: absolute;
    left: calc(100% - 2px);
    top: 50%;
    width: 0;
    height: 32px;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-50%) translateX(-4px);
    transform-origin: left center;
    transition:
        width 0.18s ease,
        opacity 0.16s ease,
        transform 0.18s ease;
    display: flex;
    align-items: center;
    overflow: hidden;
    z-index: 2;
}

.volume-control:hover .volume-control__popover,
.volume-control:focus-within .volume-control__popover {
    width: 114px;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%) translateX(0);
}

.volume-control__slider {
    width: 86px;
    height: 2px;
    margin: 0 24px 0 4px;
    border-radius: 999px;
    appearance: none;
    background:
        linear-gradient(#fff, #fff) 0 / var(--volume-percent) 100% no-repeat,
        rgba(255, 255, 255, 0.24);
    cursor: pointer;
}

.volume-control__slider::-webkit-slider-thumb {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    appearance: none;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}

.volume-control__slider::-moz-range-thumb {
    width: 9px;
    height: 9px;
    border: none;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}

.volume-control__slider:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.55);
    outline-offset: 5px;
}

.volume-control:hover + .time-display,
.volume-control:focus-within + .time-display {
    opacity: 0;
    visibility: hidden;
}

.time-display {
    margin-left: 0;
    transition:
        opacity 0.14s ease,
        visibility 0.14s ease;
}

.time-display--live {
    --live-dot-color: rgba(255, 82, 82, 0.95);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    line-height: 1;
    font-weight: 600;
}

.live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--live-dot-color);
    box-shadow: 0 0 0 3px rgba(255, 82, 82, 0.14);
}

.status-badges {
    display: inline-flex;
    gap: 6px;
    margin-left: 8px;
}

.status-badge {
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 999px;
    border: none;
    color: rgba(248, 220, 140, 0.95);
    background: none;
}
</style>
