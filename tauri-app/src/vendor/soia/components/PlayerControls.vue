<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import type { BoxPlayer } from "../types/media";
import type { SubtitleTarget } from "../composables/useSubtitleState";
import { useCasting } from "../composables/useCasting";
import { tauriCastingClient } from "../core-client/tauriCastingClient";
import SeekBar from "./player-controls/SeekBar.vue";
import LeftControls from "./player-controls/LeftControls.vue";
import RightControls from "./player-controls/RightControls.vue";

const props = defineProps<{
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    isLivePlayback: boolean;
    progressPercent: number;
    bufferedPercent: number;
    volume: number;
    formatTime: (seconds: number) => string;
    controlsVisible?: boolean;
    isHidden: boolean;
    statusBadges: string[];
    audioPassthroughActive: boolean;
    currentSpeed: number;
    currentZoom: number;
    playbackRates: number[];
    showSpeedMenu: boolean;
    showSettingsMenu: boolean;
    audioDelay: number;
    subDelay: number;
    secondarySubDelay: number;
    brightness: number;
    contrast: number;
    saturation: number;
    gamma: number;
    hue: number;
    globalColorAdjustmentsEnabled: boolean;
    globalCropZoomEnabled?: boolean;
    isLoopOne: boolean;
    audioTracks: BoxPlayer[];
    videoTracks: BoxPlayer[];
    showAudioMenu: boolean;
    subTracks: BoxPlayer[];
    dualSubEnabled: boolean;
    secondarySubId: BoxPlayer["id"];
    activeSubTarget: SubtitleTarget;
    primarySubFontFamily: string;
    secondarySubFontFamily: string;
    primarySubFontSize: number;
    secondarySubFontSize: number;
    primarySubFontColor: string;
    secondarySubFontColor: string;
    primarySubPos: number;
    secondarySubPos: number;
    showSubMenu: boolean;
    showSubtitleAdvancedSettings: boolean;
    hasAudioTracks: boolean;
    hasSubTracks: boolean;
    isFullscreen: boolean;
}>();

const casting = useCasting(tauriCastingClient);
const activeCastCapabilities = () => casting.snapshot.value.device?.capabilities;
const isCasting = () => casting.snapshot.value.sessionId !== null;
const seekDisabled = () =>
    isCasting() &&
    (!activeCastCapabilities()?.seek || !casting.snapshot.value.seekable);
const volumeDisabled = () => isCasting() && !activeCastCapabilities()?.volume;
const castFeatureDisabled = () => isCasting();
const playbackDisabled = () => {
    if (!isCasting()) return false;
    const capabilities = activeCastCapabilities();
    return !(props.isPlaying ? capabilities?.pause : capabilities?.play);
};

const seekDisabledReason = () => {
    if (!isCasting()) return undefined;
    if (!activeCastCapabilities()?.seek) return "Seek is not supported by this receiver";
    if (!casting.snapshot.value.seekable) return "This receiver has not reported a seekable timeline";
    return undefined;
};

const volumeDisabledReason = () =>
    volumeDisabled() ? "Volume control is not supported by this receiver" : undefined;
const castFeatureDisabledReason = () =>
    castFeatureDisabled() ? "This control is unavailable while casting" : undefined;
const muteDisabledReason = () =>
    isCasting() ? "Mute control is not supported by DLNA casting" : undefined;
const playbackDisabledReason = () =>
    playbackDisabled() ? "Play/pause is not supported by this receiver" : undefined;

const emit = defineEmits<{
    (e: "prev-track"): void;
    (e: "seek", position: number): void;
    (e: "toggle-play-pause"): void;
    (e: "stop-playback"): void;
    (e: "next-track"): void;
    (e: "toggle-menu", menuName: "audio" | "sub" | "speed" | "settings"): void;
    (e: "toggle-loop-one"): void;
    (e: "set-speed", rate: number): void;
    (e: "set-speed-continuously", rate: number): void;
    (e: "set-zoom", scale: number): void;
    (e: "set-aspect-ratio", ratio: string): void;
    (e: "set-volume", volume: number): void;
    (e: "toggle-muted"): void;
    (e: "set-audio-delay", value: number): void;
    (e: "set-sub-delay-for-target", payload: { target: SubtitleTarget; value: number }): void;
    (e: "set-sub-font-family", payload: { target: SubtitleTarget; value: string }): void;
    (e: "set-sub-font-size", payload: { target: SubtitleTarget; value: number }): void;
    (e: "set-sub-font-color", payload: { target: SubtitleTarget; value: string }): void;
    (e: "set-sub-position", payload: { target: SubtitleTarget; value: number }): void;
    (e: "reset-sub-appearance", target?: SubtitleTarget): void;
    (e: "set-brightness", value: number): void;
    (e: "set-contrast", value: number): void;
    (e: "set-saturation", value: number): void;
    (e: "set-gamma", value: number): void;
    (e: "set-hue", value: number): void;
    (e: "set-global-color-adjustments-enabled", enabled: boolean): void;
    (e: "set-global-crop-zoom-enabled", enabled: boolean): void;
    (e: "update-crop-zoom", payload: { zoom: number; ratio: string }): void;
    (e: "select-audio", track: BoxPlayer): void;
    (e: "select-sub-track", payload: { target: SubtitleTarget; track: BoxPlayer }): void;
    (e: "set-active-sub-target", target: SubtitleTarget): void;
    (e: "toggle-dual-sub", enabled: boolean): void;
    (e: "add-external-audio"): void;
    (e: "add-external-sub"): void;
    (e: "find-online-sub"): void;
    (e: "toggle-fullscreen"): void;
    (e: "update:showSubtitleAdvancedSettings", value: boolean): void;
}>();

const controlsViewportRef = ref<HTMLElement | null>(null);
const controlsMainRef = ref<HTMLElement | null>(null);
const controlsMainScale = ref(1);
const MIN_CONTROLS_SCALE = 0.5;
const SCALE_EXIT_BUFFER_PX = 6;
let controlsResizeObserver: ResizeObserver | null = null;
let controlsScaleRaf = 0;

const queueControlsScaleUpdate = () => {
    if (controlsScaleRaf) {
        cancelAnimationFrame(controlsScaleRaf);
    }
    controlsScaleRaf = requestAnimationFrame(() => {
        controlsScaleRaf = 0;
        updateControlsMainScale();
    });
};

const updateControlsMainScale = () => {
    const controlsViewport = controlsViewportRef.value;
    const controlsMain = controlsMainRef.value;
    if (!controlsViewport || !controlsMain) {
        controlsMainScale.value = 1;
        return;
    }
    const leftControls = controlsMain.querySelector<HTMLElement>(".controls-left");
    const rightControls = controlsMain.querySelector<HTMLElement>(".controls-right");
    if (!leftControls || !rightControls) {
        controlsMainScale.value = 1;
        return;
    }

    const measureGroupWidth = (group: HTMLElement) => {
        const groupStyle = window.getComputedStyle(group);
        const gap = Number.parseFloat(groupStyle.columnGap || groupStyle.gap || "0") || 0;
        const children = Array.from(group.children) as HTMLElement[];
        let total = 0;

        for (const child of children) {
            const rawWidth = child.offsetWidth;
            const childStyle = window.getComputedStyle(child);
            const marginLeft = Number.parseFloat(childStyle.marginLeft || "0") || 0;
            const marginRight = Number.parseFloat(childStyle.marginRight || "0") || 0;
            total += rawWidth + marginLeft + marginRight;
        }

        if (children.length > 1) {
            total += gap * (children.length - 1);
        }

        return total;
    };

    const availableWidth = controlsViewport.clientWidth;
    const requiredWidth = measureGroupWidth(leftControls) + measureGroupWidth(rightControls) + 8;

    if (availableWidth <= 0 || requiredWidth <= 0) {
        if (controlsMainScale.value !== 1) {
            controlsMainScale.value = 1;
        }
        return;
    }

    if (requiredWidth <= availableWidth) {
        if (
            controlsMainScale.value < 1 &&
            availableWidth < requiredWidth + SCALE_EXIT_BUFFER_PX
        ) {
            return;
        }
        if (controlsMainScale.value !== 1) {
            controlsMainScale.value = 1;
        }
        return;
    }

    const nextScale = Math.max(
        MIN_CONTROLS_SCALE,
        Math.min(1, availableWidth / requiredWidth),
    );
    const roundedNextScale = Math.round(nextScale * 1000) / 1000;
    if (Math.abs(roundedNextScale - controlsMainScale.value) >= 0.005) {
        controlsMainScale.value = roundedNextScale;
    }
};

onMounted(() => {
    nextTick(() => {
        queueControlsScaleUpdate();
        if (typeof ResizeObserver !== "undefined") {
            controlsResizeObserver = new ResizeObserver(queueControlsScaleUpdate);
            if (controlsViewportRef.value) {
                controlsResizeObserver.observe(controlsViewportRef.value);
            }
            const controlsMain = controlsMainRef.value;
            if (controlsMain) {
                const leftControls = controlsMain.querySelector<HTMLElement>(".controls-left");
                const rightControls = controlsMain.querySelector<HTMLElement>(".controls-right");
                if (leftControls) {
                    controlsResizeObserver.observe(leftControls);
                }
                if (rightControls) {
                    controlsResizeObserver.observe(rightControls);
                }
            }
        }
    });
});

onUnmounted(() => {
    if (controlsScaleRaf) {
        cancelAnimationFrame(controlsScaleRaf);
        controlsScaleRaf = 0;
    }
    controlsResizeObserver?.disconnect();
    controlsResizeObserver = null;
});
</script>

<template>
    <div
        class="player-controls"
        :class="{ 'ui-hidden': props.isHidden }"
    >
        <div class="player-controls-content">
            <SeekBar
                v-if="!isLivePlayback"
                :duration="duration"
                :progress-percent="progressPercent"
                :buffered-percent="bufferedPercent"
                :format-time="formatTime"
                :controls-visible="controlsVisible"
                :disabled="seekDisabled()"
                :disabled-reason="seekDisabledReason()"
                @seek="emit('seek', $event)"
            />
            <div ref="controlsViewportRef" class="controls-main-viewport">
                <div
                    ref="controlsMainRef"
                    class="controls-main"
                    :style="{
                        '--controls-main-scale': controlsMainScale.toString(),
                    }"
                >
                    <LeftControls
                        :is-playing="isPlaying"
                        :current-time="currentTime"
                        :duration="duration"
                        :is-live-playback="isLivePlayback"
                        :volume="volume"
                        :format-time="formatTime"
                        :badges="props.statusBadges"
                        :passthrough-active="audioPassthroughActive && !isCasting()"
                        :playback-disabled="playbackDisabled()"
                        :playback-disabled-reason="playbackDisabledReason()"
                        :navigation-disabled="false"
                        :navigation-disabled-reason="undefined"
                        :volume-disabled="volumeDisabled()"
                        :volume-disabled-reason="volumeDisabledReason()"
                        :mute-disabled="isCasting()"
                        :mute-disabled-reason="muteDisabledReason()"
                        @prev-track="emit('prev-track')"
                        @toggle-play-pause="emit('toggle-play-pause')"
                        @stop-playback="emit('stop-playback')"
                        @next-track="emit('next-track')"
                        @set-volume="emit('set-volume', $event)"
                        @toggle-muted="emit('toggle-muted')"
                    />
                    <RightControls
                        :current-speed="currentSpeed"
                        :current-zoom="currentZoom"
                        :playback-rates="playbackRates"
                        :show-speed-menu="showSpeedMenu"
                        :show-settings-menu="showSettingsMenu"
                        :speed-locked="audioPassthroughActive"
                        :audio-delay="audioDelay"
                        :sub-delay="subDelay"
                        :secondary-sub-delay="secondarySubDelay"
                        :brightness="brightness"
                        :contrast="contrast"
                        :saturation="saturation"
                        :gamma="gamma"
                        :hue="hue"
                        :global-color-adjustments-enabled="
                            globalColorAdjustmentsEnabled
                        "
                        :global-crop-zoom-enabled="globalCropZoomEnabled"
                        :is-loop-one="isLoopOne"
                        :audio-tracks="audioTracks"
                        :video-tracks="videoTracks"
                        :show-audio-menu="showAudioMenu"
                        :sub-tracks="subTracks"
                        :dual-sub-enabled="dualSubEnabled"
                        :secondary-sub-id="secondarySubId"
                        :active-sub-target="activeSubTarget"
                        :primary-sub-font-family="primarySubFontFamily"
                        :secondary-sub-font-family="secondarySubFontFamily"
                        :primary-sub-font-size="primarySubFontSize"
                        :secondary-sub-font-size="secondarySubFontSize"
                        :primary-sub-font-color="primarySubFontColor"
                        :secondary-sub-font-color="secondarySubFontColor"
                        :primary-sub-pos="primarySubPos"
                        :secondary-sub-pos="secondarySubPos"
                        :show-sub-menu="showSubMenu"
                        :show-subtitle-advanced-settings="showSubtitleAdvancedSettings"
                        :has-audio-tracks="hasAudioTracks"
                        :has-sub-tracks="hasSubTracks"
                        :is-fullscreen="isFullscreen"
                        :casting-disabled="castFeatureDisabled()"
                        :casting-disabled-reason="castFeatureDisabledReason()"
                        @toggle-menu="emit('toggle-menu', $event)"
                        @toggle-loop-one="emit('toggle-loop-one')"
                        @set-speed="emit('set-speed', $event)"
                        @set-zoom="emit('set-zoom', $event)"
                        @set-aspect-ratio="emit('set-aspect-ratio', $event)"
                        @set-speed-continuously="emit('set-speed-continuously', $event)"
                        @set-audio-delay="emit('set-audio-delay', $event)"
                        @set-sub-delay-for-target="
                            emit('set-sub-delay-for-target', $event)
                        "
                        @set-sub-font-family="emit('set-sub-font-family', $event)"
                        @set-sub-font-size="emit('set-sub-font-size', $event)"
                        @set-sub-font-color="emit('set-sub-font-color', $event)"
                        @set-sub-position="emit('set-sub-position', $event)"
                        @reset-sub-appearance="emit('reset-sub-appearance', $event)"
                        @set-brightness="emit('set-brightness', $event)"
                        @set-contrast="emit('set-contrast', $event)"
                        @set-saturation="emit('set-saturation', $event)"
                        @set-gamma="emit('set-gamma', $event)"
                        @set-hue="emit('set-hue', $event)"
                        @set-global-color-adjustments-enabled="
                            emit('set-global-color-adjustments-enabled', $event)
                        "
                        @set-global-crop-zoom-enabled="
                            emit('set-global-crop-zoom-enabled', $event)
                        "
                        @update-crop-zoom="
                            emit('update-crop-zoom', $event)
                        "
                        @select-audio="emit('select-audio', $event)"
                        @select-sub-track="emit('select-sub-track', $event)"
                        @set-active-sub-target="emit('set-active-sub-target', $event)"
                        @toggle-dual-sub="emit('toggle-dual-sub', $event)"
                        @add-external-audio="emit('add-external-audio')"
                        @add-external-sub="emit('add-external-sub')"
                        @find-online-sub="emit('find-online-sub')"
                        @toggle-fullscreen="emit('toggle-fullscreen')"
                        @update:show-subtitle-advanced-settings="emit('update:showSubtitleAdvancedSettings', $event)"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.player-controls {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    --controls-row-height: 35px;
    --seekbar-height: 16px;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    padding: 0 12px 8px 12px;
    transition: opacity 0.3s;
    z-index: 100;
}

.ui-hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
}

.player-controls-content {
    color: #fff;
}

.player-controls-content :deep(.controls-main-viewport) {
    width: 100%;
}

.player-controls-content :deep(.controls-main) {
    --controls-main-scale: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 35px;
    width: calc(100% / var(--controls-main-scale));
    min-width: 0;
    transform: scale(var(--controls-main-scale));
    transform-origin: left bottom;
}

.player-controls-content :deep(.controls-left),
.player-controls-content :deep(.controls-right) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}

.player-controls-content :deep(.icon-button--player) {
    width: 32px;
    height: 32px;
    padding: 1px;
}

.player-controls-content :deep(.icon-button--lg) {
    width: 32px;
    height: 32px;
}

.player-controls-content :deep(.icon-button--lg svg) {
    width: 32px;
    height: 32px;
}

.player-controls-content :deep(.time-display) {
    color: var(--time-display-color, white);
    font-size: 13px;
    margin-left: 0;
    user-select: none;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum";
}

.player-controls-content :deep(.separator) {
    margin: 0 4px;
}

.player-controls-content :deep(.track-menu-container) {
    position: relative;
    display: flex;
    align-items: center;
    padding: 2px;
    border-radius: 8px;
    transition:
        background-color 0.2s ease,
        box-shadow 0.2s ease;
}

.player-controls-content :deep(.track-menu-container:hover) {
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.player-controls-content :deep(.controls-left > .icon-button--player),
.player-controls-content :deep(.controls-right > .icon-button--player) {
    position: relative;
    border-radius: 8px;
}

.player-controls-content :deep(.controls-left > .icon-button--player::before),
.player-controls-content :deep(.controls-right > .icon-button--player::before) {
    content: "";
    position: absolute;
    inset: -2px;
    border-radius: 8px;
    opacity: 0;
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    transition: opacity 0.2s ease;
}

.player-controls-content :deep(.controls-left > .icon-button--player:hover:not(:disabled):not(.icon-button--disabled)::before),
.player-controls-content :deep(.controls-right > .icon-button--player:hover:not(:disabled):not(.icon-button--disabled)::before) {
    opacity: 1;
}

.player-controls-content :deep(.controls-left > .icon-button--player > *),
.player-controls-content :deep(.controls-right > .icon-button--player > *) {
    position: relative;
}

.player-controls-content :deep(.track-menu-container .icon-button--player) {
    border-radius: 6px;
}

.player-controls-content :deep(.controls-left > .icon-button--player:focus-visible),
.player-controls-content :deep(.controls-right > .icon-button--player:focus-visible),
.player-controls-content :deep(.track-menu-container .icon-button--player:focus-visible) {
    outline: 2px solid rgba(255, 255, 255, 0.5);
    outline-offset: 2px;
}

.player-controls-content :deep(.subtitle-icon) {
    width: 24px;
    height: 24px;
}

.player-controls-content :deep(.loop-toggle--active) {
    color: #8fb3ff;
}
</style>
