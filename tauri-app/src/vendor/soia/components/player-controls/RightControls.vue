<script setup lang="ts">
import { invoke } from "@/features/player/soia/native";
import { listen } from "@tauri-apps/api/event";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { BoxPlayer } from "../../types/media";
import type { SubtitleTarget } from "../../composables/useSubtitleState";
import {
    getAudioTrackDetails,
    getAudioTrackHoverTitle,
    getAudioTrackTitle,
    getSubtitleTrackDetails,
    getSubtitleTrackHoverTitle,
    getSubtitleTrackTitle,
} from "../../utils/trackDisplay";
import ControlSlider from "./ControlSlider.vue";

const props = defineProps<{
    currentSpeed: number;
    currentZoom: number;
    playbackRates: number[];
    showSpeedMenu: boolean;
    showSettingsMenu: boolean;
    speedLocked: boolean;
    castingDisabled?: boolean;
    castingDisabledReason?: string;
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

const emit = defineEmits<{
    (e: "toggle-menu", menuName: "audio" | "sub" | "speed" | "settings"): void;
    (e: "toggle-loop-one"): void;
    (e: "set-speed", rate: number): void;
    (e: "set-speed-continuously", rate: number): void;
    (e: "set-zoom", scale: number): void;
    (e: "set-aspect-ratio", ratio: string): void;
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

const isNativePipPlatform =
    typeof navigator !== "undefined" &&
    /\b(mac|darwin|windows)\b/i.test(navigator.userAgent);
const isMacPlatform =
    typeof navigator !== "undefined" && /\b(mac|darwin)\b/i.test(navigator.userAgent);
const isWindowsPlatform =
    typeof navigator !== "undefined" && /\bwindows\b/i.test(navigator.userAgent);

const isPipEnabled = ref(false);
const isTogglingPip = ref(false);
const renderedSubtitleTrackCount = ref(0);
let unlistenNativePipChanged: (() => void) | null = null;
let subtitleRenderFrame: number | null = null;

const SUBTITLE_RENDER_BATCH_SIZE = 48;

const subtitleFontOptions = [
    "",
    "Arial",
    "Helvetica Neue",
    "PingFang SC",
    "Hiragino Sans GB",
    "Microsoft YaHei",
    "Noto Sans CJK SC",
    "Source Han Sans SC",
    "Verdana",
    "Georgia",
    "Times New Roman",
    "Courier New",
    "JetBrains Mono",
];

const isSameTrackId = (left: BoxPlayer["id"], right: BoxPlayer["id"]) =>
    String(left) === String(right);

const currentRatio = ref<string>("Auto");
const internalZoom = ref<number>(1.0);
type VideoSettingsTab = "picture" | "framing";
const activeVideoSettingsTab = ref<VideoSettingsTab>("picture");
const pictureVideoSettingsTab = ref<HTMLButtonElement | null>(null);
const framingVideoSettingsTab = ref<HTMLButtonElement | null>(null);

const selectVideoSettingsTab = (
    tab: VideoSettingsTab,
    shouldFocus = false,
) => {
    activeVideoSettingsTab.value = tab;
    if (!shouldFocus) return;
    void nextTick(() => {
        const tabButton =
            tab === "picture"
                ? pictureVideoSettingsTab.value
                : framingVideoSettingsTab.value;
        tabButton?.focus();
    });
};

const moveVideoSettingsTabFocus = () => {
    selectVideoSettingsTab(
        activeVideoSettingsTab.value === "picture" ? "framing" : "picture",
        true,
    );
};

watch(
    () => props.currentZoom,
    (val) => {
        if (typeof val === "number" && !isNaN(val) && val > 0) {
            internalZoom.value = val;
        }
    },
    { immediate: true },
);

const CROP_RATIO_PRESETS: Record<string, number | null> = {
    Auto: null,
    "16:9": 16 / 9,
    "16:10": 16 / 10,
    "4:3": 4 / 3,
    "21:9": 21 / 9,
    "2.35:1": 2.35,
};

const applyCropRatioPreset = async (key: string) => {
    currentRatio.value = key;
    const target = CROP_RATIO_PRESETS[key];

    try {
        await invoke("mpv_run_command", {
            args: ["set", "video-aspect-override", "no"],
        });
    } catch {}

    if (target === null || target === undefined) {
        internalZoom.value = 1.0;
        emit("set-zoom", 1.0);
        emit("set-aspect-ratio", "no");
        emit("update-crop-zoom", { zoom: 1.0, ratio: "Auto" });
        try {
            await invoke("mpv_run_command", {
                args: ["set", "video-zoom", "0"],
            });
        } catch {}
        return;
    }

    const activeVideo =
        props.videoTracks?.find((t) => t.selected) || props.videoTracks?.[0];
    const w = activeVideo?.demux_w || activeVideo?.w;
    const h = activeVideo?.demux_h || activeVideo?.h;
    const baseRatio = w && h && w > 0 && h > 0 ? w / h : 16 / 9;
    const zoomMultiplier = Math.max(target / baseRatio, baseRatio / target);
    const clampedZoom = Math.min(
        4.0,
        Math.max(0.1, Math.round(zoomMultiplier * 100) / 100),
    );

    internalZoom.value = clampedZoom;
    emit("set-zoom", clampedZoom);
    emit("set-aspect-ratio", "no");
    emit("update-crop-zoom", { zoom: clampedZoom, ratio: key });

    try {
        const mpvZoom = Math.log2(clampedZoom);
        await invoke("mpv_run_command", {
            args: ["set", "video-zoom", String(mpvZoom.toFixed(6))],
        });
    } catch (e) {
        console.error("Failed to apply crop zoom:", e);
    }
};

const setZoom = async (val: number) => {
    internalZoom.value = val;
    currentRatio.value = "";
    emit("set-zoom", val);
    emit("update-crop-zoom", { zoom: val, ratio: "" });
    try {
        const mpvZoom = Math.log2(val);
        await invoke("mpv_run_command", {
            args: ["set", "video-zoom", String(mpvZoom.toFixed(6))],
        });
    } catch (e) {
        console.error("Failed to set video-zoom:", e);
    }
};

const activeSubTarget = computed(() => props.activeSubTarget);
const activeSubFontFamily = computed(() =>
    props.primarySubFontFamily,
);
const activeSubFontOptions = computed(() => {
    if (
        !activeSubFontFamily.value ||
        subtitleFontOptions.includes(activeSubFontFamily.value)
    ) {
        return subtitleFontOptions;
    }
    return [subtitleFontOptions[0], activeSubFontFamily.value, ...subtitleFontOptions.slice(1)];
});
const activeSubFontSize = computed(() =>
    props.primarySubFontSize,
);
const activeSubFontColor = computed(() =>
    props.primarySubFontColor,
);

const activeTrackId = computed<BoxPlayer["id"]>(() =>
    props.activeSubTarget === "primary"
        ? props.subTracks.find((track) => track.selected)?.id ?? 0
        : props.secondarySubId,
);

const primaryTrackId = computed<BoxPlayer["id"]>(
    () => props.subTracks.find((track) => track.selected)?.id ?? 0,
);
const visibleSubTracks = computed(() =>
    props.subTracks.slice(0, renderedSubtitleTrackCount.value),
);
const audioTrackRows = computed(() =>
    props.audioTracks.map((track) => ({
        track,
        title: getAudioTrackTitle(track),
        details: getAudioTrackDetails(track),
        hoverTitle: getAudioTrackHoverTitle(track),
    })),
);

const cancelSubtitleRenderFrame = () => {
    if (subtitleRenderFrame == null) return;
    window.cancelAnimationFrame(subtitleRenderFrame);
    subtitleRenderFrame = null;
};

const scheduleSubtitleTrackRendering = () => {
    cancelSubtitleRenderFrame();
    if (!props.showSubMenu || props.showSubtitleAdvancedSettings) return;
    const total = props.subTracks.length;
    if (!total) {
        renderedSubtitleTrackCount.value = 0;
        return;
    }
    renderedSubtitleTrackCount.value = Math.min(
        Math.max(renderedSubtitleTrackCount.value, SUBTITLE_RENDER_BATCH_SIZE),
        total,
    );
    const renderNextBatch = () => {
        if (!props.showSubMenu || props.showSubtitleAdvancedSettings) {
            subtitleRenderFrame = null;
            return;
        }
        renderedSubtitleTrackCount.value = Math.min(
            renderedSubtitleTrackCount.value + SUBTITLE_RENDER_BATCH_SIZE,
            props.subTracks.length,
        );
        if (renderedSubtitleTrackCount.value < props.subTracks.length) {
            subtitleRenderFrame = window.requestAnimationFrame(renderNextBatch);
        } else {
            subtitleRenderFrame = null;
        }
    };
    if (renderedSubtitleTrackCount.value < total) {
        subtitleRenderFrame = window.requestAnimationFrame(renderNextBatch);
    }
};

const isTrackDisabled = (track: BoxPlayer) => {
    if (!props.dualSubEnabled) return false;
    if (String(track.id) === "0") return false;
    if (props.activeSubTarget === "primary") {
        return isSameTrackId(track.id, props.secondarySubId);
    }
    return isSameTrackId(track.id, primaryTrackId.value);
};

const isTrackSelectedByOtherTarget = (track: BoxPlayer) => {
    if (!props.dualSubEnabled) return false;
    if (String(track.id) === "0") return false;
    if (props.activeSubTarget === "primary") {
        return isSameTrackId(track.id, props.secondarySubId);
    }
    return isSameTrackId(track.id, primaryTrackId.value);
};

const visibleSubTrackRows = computed(() =>
    visibleSubTracks.value.map((track) => {
        const disabled = isTrackDisabled(track);
        return {
            track,
            disabled,
            selected:
                isSameTrackId(track.id, activeTrackId.value) && !disabled,
            selectedByOtherTarget: isTrackSelectedByOtherTarget(track),
            title: getSubtitleTrackTitle(track),
            details: getSubtitleTrackDetails(track),
            hoverTitle: getSubtitleTrackHoverTitle(track),
        };
    }),
);

const onSelectSubTrack = (track: BoxPlayer) => {
    emit("select-sub-track", { target: props.activeSubTarget, track });
};

const onChangeActiveSubDelay = (value: number) => {
    emit("set-sub-delay-for-target", {
        target: props.activeSubTarget,
        value,
    });
};

const onResetActiveSubDelay = () => {
    onChangeActiveSubDelay(0);
};

const onChangeActiveSubFontFamily = (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    emit("set-sub-font-family", {
        target: props.activeSubTarget,
        value: input?.value ?? "",
    });
};

const onChangeActiveSubFontSize = (value: number) => {
    emit("set-sub-font-size", {
        target: props.activeSubTarget,
        value,
    });
};

const onChangeActiveSubFontColor = (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    emit("set-sub-font-color", {
        target: props.activeSubTarget,
        value: input?.value ?? "#ffffff",
    });
};

const onChangeSubPosition = (target: SubtitleTarget, value: number) => {
    emit("set-sub-position", {
        target,
        value,
    });
};

const onResetActiveSubAppearance = () => {
    emit("reset-sub-appearance", undefined);
};

const refreshPipState = async () => {
    if (!isNativePipPlatform) return;
    try {
        isPipEnabled.value = await invoke<boolean>("is_native_pip_enabled");
    } catch {
        // Ignore in non-Tauri environments.
    }
};

const onTogglePip = async () => {
    if (!isNativePipPlatform) return;
    if (isTogglingPip.value) return;
    isTogglingPip.value = true;
    try {
        const nextValue = !isPipEnabled.value;
        await invoke("set_native_pip_enabled", { enabled: nextValue });
        isPipEnabled.value = nextValue;
    } finally {
        isTogglingPip.value = false;
    }
};

onMounted(async () => {
    await refreshPipState();
    if (!isNativePipPlatform) return;
    try {
        unlistenNativePipChanged = await listen<boolean>("native-pip-changed", (event) => {
            isPipEnabled.value = Boolean(event.payload);
        });
    } catch {
        // Ignore in non-Tauri environments.
    }
});

onUnmounted(() => {
    unlistenNativePipChanged?.();
    unlistenNativePipChanged = null;
    cancelSubtitleRenderFrame();
});

watch(
    () => props.showSubMenu,
    (showSubMenu) => {
        if (!showSubMenu) {
            emit("update:showSubtitleAdvancedSettings", false);
            renderedSubtitleTrackCount.value = 0;
            cancelSubtitleRenderFrame();
            return;
        }
        renderedSubtitleTrackCount.value = 0;
        scheduleSubtitleTrackRendering();
    },
);

watch(
    () => [props.subTracks.length, props.showSubtitleAdvancedSettings] as const,
    () => {
        if (!props.showSubMenu) return;
        if (props.showSubtitleAdvancedSettings) {
            cancelSubtitleRenderFrame();
            return;
        }
        scheduleSubtitleTrackRendering();
    },
);
</script>

<template>
    <div class="controls-right">
        <div class="track-menu-container">
            <button
                class="icon-button icon-button--player"
                :disabled="speedLocked || props.castingDisabled"
                :aria-description="
                    props.castingDisabled
                        ? props.castingDisabledReason
                        : speedLocked
                        ? 'Playback speed is fixed during audio passthrough'
                        : undefined
                "
                :data-disabled-reason="
                    props.castingDisabled || speedLocked
                        ? props.castingDisabled
                            ? props.castingDisabledReason
                            : 'Playback speed is fixed during audio passthrough'
                        : undefined
                "
                @click.stop="emit('toggle-menu', 'speed')"
                :title="
                    props.castingDisabled
                        ? props.castingDisabledReason
                        : speedLocked
                        ? 'Playback speed is fixed during audio passthrough'
                        : 'Playback Speed'
                "
            >
                {{ currentSpeed }}x
            </button>

            <transition name="fade-up">
                <div v-if="showSpeedMenu && !props.castingDisabled" class="track-menu">
                    <div class="track-menu__header">Playback Speed</div>
                    <div class="track-menu__list">
                        <button
                            v-for="rate in playbackRates"
                            :key="rate"
                            class="track-menu__item"
                            :class="{
                                'track-menu__item--active':
                                    currentSpeed === rate,
                            }"
                            type="button"
                            @click="emit('set-speed', rate)"
                        >
                            <span class="track-menu__check">
                                <svg
                                    v-if="currentSpeed === rate"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                >
                                    <path
                                        d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                    />
                                </svg>
                            </span>
                            <span class="track-menu__text">{{
                                rate === 1 ? "Normal" : rate + "x"
                            }}</span>
                        </button>
                    </div>
                    <div class="track-menu__footer">
                        <ControlSlider
                            label="Speed"
                            :value="currentSpeed"
                            :min="0.1"
                            :max="4"
                            :step="0.1"
                            unit="×"
                            :show-reset="false"
                            :precision="1"
                            @change="emit('set-speed-continuously', $event)"
                        />
                    </div>
                </div>
            </transition>
        </div>

        <div class="track-menu-container">
            <button
                class="icon-button icon-button--player loop-toggle"
                :class="{ 'loop-toggle--active': isLoopOne }"
                :disabled="props.castingDisabled"
                :aria-description="props.castingDisabledReason"
                :data-disabled-reason="props.castingDisabled ? props.castingDisabledReason : undefined"
                @click.stop="emit('toggle-loop-one')"
                :title="props.castingDisabledReason || 'Loop One'"
                :aria-pressed="isLoopOne"
            >
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path
                        d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-2v6h2z"
                    />
                </svg>
            </button>
        </div>

        <div class="track-menu-container">
            <button
                class="icon-button icon-button--player"
                :disabled="props.castingDisabled"
                :aria-description="props.castingDisabledReason"
                :data-disabled-reason="props.castingDisabled ? props.castingDisabledReason : undefined"
                @click.stop="emit('toggle-menu', 'audio')"
                :title="props.castingDisabledReason || 'Audio Tracks'"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                >
                    <path
                        d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                    />
                </svg>
            </button>

            <transition name="fade-up">
                <div
                    v-if="showAudioMenu && !props.castingDisabled"
                    class="track-menu track-menu--wide track-menu--audio"
                >
                    <div class="track-menu__header">
                        <span>Audio</span>
                        <button
                            class="icon-button track-menu__header-action"
                            type="button"
                            title="Add external audio track"
                            aria-label="Add external audio track"
                            @click.stop="emit('add-external-audio')"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path
                                    d="M12 5v14M5 12h14"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                />
                            </svg>
                        </button>
                    </div>
                    <div class="track-menu__list">
                        <button
                            v-for="row in audioTrackRows"
                            :key="row.track.id"
                            class="track-menu__item track-menu__item--audio"
                            :class="{ 'track-menu__item--active': row.track.selected }"
                            type="button"
                            :title="row.hoverTitle"
                            @click="emit('select-audio', row.track)"
                        >
                            <span class="track-menu__check">
                                <svg
                                    v-if="row.track.selected"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                >
                                    <path
                                        d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                    />
                                </svg>
                            </span>
                            <span class="track-menu__text track-menu__text--audio">
                                <span class="track-menu__audio-title">
                                    {{ row.title }}
                                </span>
                                <span
                                    v-if="row.details.length"
                                    class="track-menu__audio-details"
                                >
                                    <span
                                        v-for="detail in row.details"
                                        :key="detail"
                                        class="track-menu__audio-detail"
                                    >
                                        {{ detail }}
                                    </span>
                                </span>
                            </span>
                        </button>
                    </div>
                    <div v-if="props.hasAudioTracks" class="track-menu__footer">
                        <ControlSlider
                            label="Delay"
                            :value="audioDelay"
                            :min="-5"
                            :max="5"
                            :step="0.1"
                            unit="s"
                            :show-sign="true"
                            :precision="1"
                            @change="emit('set-audio-delay', $event)"
                            @reset="emit('set-audio-delay', 0)"
                        />
                    </div>
                </div>
            </transition>
        </div>

        <div class="track-menu-container">
            <button
                class="icon-button icon-button--player"
                :disabled="props.castingDisabled"
                :aria-description="props.castingDisabledReason"
                :data-disabled-reason="props.castingDisabled ? props.castingDisabledReason : undefined"
                @click.stop="emit('toggle-menu', 'sub')"
                :title="props.castingDisabledReason || 'Subtitles'"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="subtitle-icon"
                    viewBox="0 -960 960 960"
                    fill="currentColor"
                >
                    <path
                        d="M240-320h320v-80H240v80Zm400 0h80v-80h-80v80ZM240-480h80v-80h-80v80Zm160 0h320v-80H400v80ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Z"
                    />
                </svg>
            </button>

            <transition name="fade-up">
                <div
                    v-if="showSubMenu && !props.castingDisabled"
                    class="track-menu track-menu--wide track-menu--subtitle"
                    :class="{
                        'track-menu--subtitle-advanced':
                            props.showSubtitleAdvancedSettings,
                    }"
                >
                    <div class="track-menu__header">
                        <div class="track-menu__title-group">
                            <button
                                v-if="props.showSubtitleAdvancedSettings"
                                class="track-menu__back-button"
                                type="button"
                                title="Back to subtitle tracks"
                                aria-label="Back to subtitle tracks"
                                @click.stop="
                                    emit('update:showSubtitleAdvancedSettings', false)
                                "
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    height="24px"
                                    viewBox="0 -960 960 960"
                                    width="24px"
                                    fill="currentColor"
                                    aria-hidden="true"
                                >
                                    <path
                                        d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"
                                    />
                                </svg>
                            </button>
                            <button
                                v-else
                                class="icon-button track-menu__header-action track-menu__header-action--compact"
                                type="button"
                                title="Advanced subtitle settings"
                                aria-label="Advanced subtitle settings"
                                @click.stop="emit('update:showSubtitleAdvancedSettings', true)"
                            >
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path
                                        d="M5 7q-.83 0-1.415-.585Q3 5.83 3 5q0-.83.585-1.415Q4.17 3 5 3q.83 0 1.415.585Q7 4.17 7 5q0 .83-.585 1.415Q5.83 7 5 7Zm0-2ZM2 6V4H1v2h1Zm21 0V4H8v2h15Zm-8 8q-.83 0-1.415-.585Q13 12.83 13 12q0-.83.585-1.415Q14.17 10 15 10q.83 0 1.415.585Q17 11.17 17 12q0 .83-.585 1.415Q15.83 14 15 14Zm0-2ZM12 13v-2H1v2h11Zm11 0v-2h-5v2h5ZM8 21q-.83 0-1.415-.585Q6 19.83 6 19q0-.83.585-1.415Q7.17 17 8 17q.83 0 1.415.585Q10 18.17 10 19q0 .83-.585 1.415Q8.83 21 8 21Zm0-2ZM5 20v-2H1v2h4Zm18 0v-2H11v2h12Z"
                                    />
                                </svg>
                            </button>
                            <span>
                                {{
                                    props.showSubtitleAdvancedSettings
                                        ? "Advance Settings"
                                        : "Subtitle"
                                }}
                            </span>
                        </div>
                        <div
                            v-if="!props.showSubtitleAdvancedSettings"
                            class="track-menu__header-actions"
                        >
                            <button
                                class="track-menu__dual-button"
                                :class="{ 'track-menu__dual-button--active': dualSubEnabled }"
                                type="button"
                                :aria-pressed="dualSubEnabled"
                                :title="dualSubEnabled ? 'Dual subtitles' : 'Single subtitle'"
                                @click.stop="emit('toggle-dual-sub', !dualSubEnabled)"
                            >
                                Dual
                            </button>
                            <button
                                class="icon-button track-menu__header-action"
                                type="button"
                                title="Add external subtitles"
                                aria-label="Add external subtitles"
                                @click.stop="emit('add-external-sub')"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <path
                                        d="M12 5v14M5 12h14"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                    />
                                </svg>
                            </button>
                            <button
                                class="icon-button track-menu__header-action"
                                type="button"
                                title="Find online subtitles"
                                aria-label="Find online subtitles"
                                @click.stop="emit('find-online-sub')"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/></svg>
                            </button>
                        </div>
                    </div>
                    <div
                        v-if="props.showSubtitleAdvancedSettings"
                        class="track-menu__list track-menu__list--subtitle-advanced"
                    >
                        <div class="subtitle-advanced">
                            <label class="subtitle-advanced__field subtitle-advanced__field--inline">
                                <span>Font</span>
                                <select
                                    class="subtitle-advanced__input subtitle-advanced__select"
                                    :value="activeSubFontFamily"
                                    @change="onChangeActiveSubFontFamily"
                                >
                                    <option
                                        v-for="font in activeSubFontOptions"
                                        :key="font || 'default'"
                                        :value="font"
                                    >
                                        {{ font || "Default" }}
                                    </option>
                                </select>
                            </label>
                            <label class="subtitle-advanced__field subtitle-advanced__field--inline">
                                <span>Color</span>
                                <span class="subtitle-advanced__color-row">
                                    <input
                                        class="subtitle-advanced__color"
                                        type="color"
                                        :value="activeSubFontColor"
                                        @input="onChangeActiveSubFontColor"
                                    />
                                    <span class="subtitle-advanced__color-value">
                                        {{ activeSubFontColor }}
                                    </span>
                                </span>
                            </label>
                            <ControlSlider
                                label="Scale"
                                :value="activeSubFontSize"
                                :min="8"
                                :max="200"
                                :step="1"
                                unit=""
                                :precision="0"
                                @change="onChangeActiveSubFontSize"
                                @reset="onChangeActiveSubFontSize(38)"
                            />
                            <ControlSlider
                                v-if="!dualSubEnabled"
                                label="Position"
                                :value="primarySubPos"
                                :min="0"
                                :max="100"
                                :step="1"
                                unit=""
                                :precision="0"
                                @change="onChangeSubPosition('primary', $event)"
                                @reset="onChangeSubPosition('primary', 100)"
                            />
                            <ControlSlider
                                v-else
                                label="Primary Position"
                                :value="primarySubPos"
                                :min="0"
                                :max="100"
                                :step="1"
                                unit=""
                                :precision="0"
                                @change="onChangeSubPosition('primary', $event)"
                                @reset="onChangeSubPosition('primary', 100)"
                            />
                            <ControlSlider
                                v-if="dualSubEnabled"
                                label="Secondary Position"
                                :value="secondarySubPos"
                                :min="0"
                                :max="100"
                                :step="1"
                                unit=""
                                :precision="0"
                                @change="onChangeSubPosition('secondary', $event)"
                                @reset="onChangeSubPosition('secondary', 0)"
                            />
                            <button
                                class="subtitle-advanced__reset"
                                type="button"
                                @click="onResetActiveSubAppearance"
                            >
                                Reset appearance
                            </button>
                        </div>
                    </div>
                    <div v-else class="track-menu__list">
                        <div v-if="dualSubEnabled" class="track-menu__sub-targets">
                            <button
                                class="track-menu__sub-target"
                                :class="{
                                    'track-menu__sub-target--active':
                                        activeSubTarget === 'primary',
                                }"
                                type="button"
                                @click="emit('set-active-sub-target', 'primary')"
                            >
                                PRIMARY
                            </button>
                            <button
                                class="track-menu__sub-target"
                                :class="{
                                    'track-menu__sub-target--active':
                                        activeSubTarget === 'secondary',
                                }"
                                type="button"
                                @click="emit('set-active-sub-target', 'secondary')"
                            >
                                SECONDARY
                            </button>
                        </div>
                        <div class="track-menu__section">
                            <button
                                v-for="row in visibleSubTrackRows"
                                :key="row.track.id"
                                class="track-menu__item track-menu__item--subtitle"
                                :class="{
                                    'track-menu__item--active': row.selected,
                                    'track-menu__item--disabled': row.disabled,
                                }"
                                type="button"
                                :disabled="row.disabled"
                                :title="row.hoverTitle"
                                @click="onSelectSubTrack(row.track)"
                            >
                                <span class="track-menu__check">
                                    <svg
                                        v-if="
                                            row.selected ||
                                            row.selectedByOtherTarget
                                        "
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                    >
                                        <path
                                            d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                        />
                                    </svg>
                                </span>
                                <span class="track-menu__text track-menu__text--subtitle">
                                    <span class="track-menu__subtitle-title">
                                        {{ row.title }}
                                    </span>
                                    <span
                                        v-if="row.details.length"
                                        class="track-menu__subtitle-details"
                                    >
                                        <span
                                            v-for="detail in row.details"
                                            :key="detail"
                                            class="track-menu__subtitle-detail"
                                        >
                                            {{ detail }}
                                        </span>
                                    </span>
                                </span>
                            </button>
                        </div>
                    </div>
                    <div
                        v-if="props.hasSubTracks && !props.showSubtitleAdvancedSettings"
                        class="track-menu__footer"
                    >
                        <ControlSlider
                            :label="dualSubEnabled ? 'Delay' : 'Delay'"
                            :value="
                                dualSubEnabled
                                    ? activeSubTarget === 'primary'
                                        ? subDelay
                                        : secondarySubDelay
                                    : subDelay
                            "
                            :min="-10"
                            :max="10"
                            :step="0.1"
                            unit="s"
                            :show-sign="true"
                            :precision="1"
                            @change="onChangeActiveSubDelay"
                            @reset="onResetActiveSubDelay"
                        />
                    </div>
                </div>
            </transition>
        </div>

        <div class="track-menu-container">
            <button
                class="icon-button icon-button--player"
                :disabled="props.castingDisabled"
                :aria-description="props.castingDisabledReason"
                :data-disabled-reason="props.castingDisabled ? props.castingDisabledReason : undefined"
                @click.stop="emit('toggle-menu', 'settings')"
                :title="props.castingDisabledReason || 'Video'"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="settings-icon"
                    height="24px"
                    viewBox="0 -960 960 960"
                    width="24px"
                    fill="currentColor"
                >
                    <path
                        d="M480-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v200h-80v-200H160v480h320v80ZM380-300v-360l280 180-280 180ZM714-40l-12-60q-12-5-22.5-10.5T658-124l-58 18-40-68 46-40q-2-14-2-26t2-26l-46-40 40-68 58 18q11-8 21.5-13.5T702-380l12-60h80l12 60q12 5 22.5 11t21.5 15l58-20 40 70-46 40q2 12 2 25t-2 25l46 40-40 68-58-18q-11 8-21.5 13.5T806-100l-12 60h-80Zm40-120q33 0 56.5-23.5T834-240q0-33-23.5-56.5T754-320q-33 0-56.5 23.5T674-240q0 33 23.5 56.5T754-160Z"
                    />
                </svg>
            </button>

            <transition name="fade-up">
                <div
                    v-if="showSettingsMenu && !props.castingDisabled"
                    class="track-menu track-menu--settings track-menu--video-settings"
                >
                    <div class="track-menu__header">
                        <span>Video</span>
                        <div class="track-menu__header-actions">
                            <button
                                v-if="activeVideoSettingsTab === 'picture'"
                                class="track-menu__mode-toggle"
                                type="button"
                                :aria-pressed="globalColorAdjustmentsEnabled"
                                :title="
                                    globalColorAdjustmentsEnabled
                                        ? 'Global apply enabled'
                                        : 'Enable global apply'
                                "
                                @click.stop="
                                    emit(
                                        'set-global-color-adjustments-enabled',
                                        !globalColorAdjustmentsEnabled,
                                    )
                                "
                            >
                                <span class="track-menu__mode-label">Global</span>
                                <span
                                    class="track-menu__mode-switch"
                                    :class="{
                                        'track-menu__mode-switch--on':
                                            globalColorAdjustmentsEnabled,
                                    }"
                                >
                                    <span class="track-menu__mode-thumb"></span>
                                </span>
                            </button>
                            <button
                                v-else
                                class="track-menu__mode-toggle"
                                type="button"
                                :aria-pressed="globalCropZoomEnabled"
                                :title="
                                    globalCropZoomEnabled
                                        ? 'Global apply enabled'
                                        : 'Enable global apply'
                                "
                                @click.stop="
                                    emit(
                                        'set-global-crop-zoom-enabled',
                                        !globalCropZoomEnabled,
                                    )
                                "
                            >
                                <span class="track-menu__mode-label">Global</span>
                                <span
                                    class="track-menu__mode-switch"
                                    :class="{
                                        'track-menu__mode-switch--on':
                                            globalCropZoomEnabled,
                                    }"
                                >
                                    <span class="track-menu__mode-thumb"></span>
                                </span>
                            </button>
                        </div>
                    </div>
                    <div class="video-settings">
                        <div class="video-settings__content">
                            <div
                                v-show="activeVideoSettingsTab === 'picture'"
                                id="video-settings-panel-picture"
                                class="track-menu__list track-menu__list--settings"
                                role="tabpanel"
                                aria-labelledby="video-settings-tab-picture"
                            >
                        <ControlSlider
                            label="Brightness"
                            :value="brightness"
                            :min="-100"
                            :max="100"
                            :step="1"
                            unit="%"
                            :show-sign="true"
                            :precision="0"
                            @change="emit('set-brightness', $event)"
                            @reset="emit('set-brightness', 0)"
                        />
                        <ControlSlider
                            label="Contrast"
                            :value="contrast"
                            :min="-100"
                            :max="100"
                            :step="1"
                            unit="%"
                            :show-sign="true"
                            :precision="0"
                            @change="emit('set-contrast', $event)"
                            @reset="emit('set-contrast', 0)"
                        />
                        <ControlSlider
                            label="Saturation"
                            :value="saturation"
                            :min="-100"
                            :max="100"
                            :step="1"
                            unit="%"
                            :show-sign="true"
                            :precision="0"
                            @change="emit('set-saturation', $event)"
                            @reset="emit('set-saturation', 0)"
                        />
                        <ControlSlider
                            label="Gamma"
                            :value="gamma"
                            :min="-100"
                            :max="100"
                            :step="1"
                            unit="%"
                            :show-sign="true"
                            :precision="0"
                            @change="emit('set-gamma', $event)"
                            @reset="emit('set-gamma', 0)"
                        />
                        <ControlSlider
                            label="Hue"
                            :value="hue"
                            :min="-100"
                            :max="100"
                            :step="1"
                            unit="%"
                            :show-sign="true"
                            :precision="0"
                            @change="emit('set-hue', $event)"
                            @reset="emit('set-hue', 0)"
                        />
                        </div>
                        <div
                            v-show="activeVideoSettingsTab === 'framing'"
                            id="video-settings-panel-framing"
                            class="track-menu__list track-menu__list--settings"
                            role="tabpanel"
                            aria-labelledby="video-settings-tab-framing"
                        >
                            <div class="framing-ratio-control">
                                <div class="framing-ratio-control__header">
                                    <span>Aspect Ratio</span>
                                </div>
                                <div class="panel__crop-presets">
                                    <button
                                        type="button"
                                        class="panel__crop-preset"
                                        :class="{ 'panel__crop-preset--active': currentRatio === 'Auto' }"
                                        @click="applyCropRatioPreset('Auto')"
                                    >
                                        Auto
                                    </button>
                                    <button
                                        type="button"
                                        class="panel__crop-preset"
                                        :class="{ 'panel__crop-preset--active': currentRatio === '16:9' }"
                                        @click="applyCropRatioPreset('16:9')"
                                    >
                                        16:9
                                    </button>
                                    <button
                                        type="button"
                                        class="panel__crop-preset"
                                        :class="{ 'panel__crop-preset--active': currentRatio === '16:10' }"
                                        @click="applyCropRatioPreset('16:10')"
                                    >
                                        16:10
                                    </button>
                                    <button
                                        type="button"
                                        class="panel__crop-preset"
                                        :class="{ 'panel__crop-preset--active': currentRatio === '4:3' }"
                                        @click="applyCropRatioPreset('4:3')"
                                    >
                                        4:3
                                    </button>
                                    <button
                                        type="button"
                                        class="panel__crop-preset"
                                        :class="{ 'panel__crop-preset--active': currentRatio === '21:9' }"
                                        @click="applyCropRatioPreset('21:9')"
                                    >
                                        21:9
                                    </button>
                                    <button
                                        type="button"
                                        class="panel__crop-preset"
                                        :class="{ 'panel__crop-preset--active': currentRatio === '2.35:1' }"
                                        @click="applyCropRatioPreset('2.35:1')"
                                    >
                                        2.35:1
                                    </button>
                                </div>
                            </div>
                            <ControlSlider
                                label="Zoom"
                                :value="internalZoom"
                                :min="0.5"
                                :max="3.0"
                                :step="0.05"
                                unit="x"
                                :show-sign="false"
                                :precision="2"
                                @change="setZoom($event)"
                                @reset="setZoom(1.0)"
                            />
                        </div>
                        </div>
                        <nav
                            class="video-settings__tabs"
                            aria-label="Video settings"
                            role="tablist"
                        >
                            <button
                                id="video-settings-tab-picture"
                                ref="pictureVideoSettingsTab"
                                class="video-settings__tab"
                                type="button"
                                role="tab"
                                :class="{
                                    'video-settings__tab--active':
                                        activeVideoSettingsTab === 'picture',
                                }"
                                :aria-selected="activeVideoSettingsTab === 'picture'"
                                aria-controls="video-settings-panel-picture"
                                :tabindex="activeVideoSettingsTab === 'picture' ? 0 : -1"
                                @click="selectVideoSettingsTab('picture')"
                                @keydown.left.prevent="moveVideoSettingsTabFocus"
                                @keydown.right.prevent="moveVideoSettingsTabFocus"
                                @keydown.home.prevent="selectVideoSettingsTab('picture', true)"
                                @keydown.end.prevent="selectVideoSettingsTab('framing', true)"
                            >
                                Picture
                            </button>
                            <button
                                id="video-settings-tab-framing"
                                ref="framingVideoSettingsTab"
                                class="video-settings__tab"
                                type="button"
                                role="tab"
                                :class="{
                                    'video-settings__tab--active':
                                        activeVideoSettingsTab === 'framing',
                                }"
                                :aria-selected="activeVideoSettingsTab === 'framing'"
                                aria-controls="video-settings-panel-framing"
                                :tabindex="activeVideoSettingsTab === 'framing' ? 0 : -1"
                                @click="selectVideoSettingsTab('framing')"
                                @keydown.left.prevent="moveVideoSettingsTabFocus"
                                @keydown.right.prevent="moveVideoSettingsTabFocus"
                                @keydown.home.prevent="selectVideoSettingsTab('picture', true)"
                                @keydown.end.prevent="selectVideoSettingsTab('framing', true)"
                            >
                                Crop &amp; Zoom
                            </button>
                        </nav>
                    </div>
                </div>
            </transition>
        </div>

        <button
            v-if="isNativePipPlatform"
            class="icon-button icon-button--player icon-button--lg pip-toggle"
            :class="{ 'pip-toggle--active': isPipEnabled }"
            type="button"
            :disabled="isTogglingPip || props.castingDisabled"
            :aria-disabled="isTogglingPip || props.castingDisabled"
            :aria-description="props.castingDisabled ? props.castingDisabledReason : undefined"
            :data-disabled-reason="props.castingDisabled ? props.castingDisabledReason : undefined"
            :aria-pressed="isPipEnabled"
            :title="
                props.castingDisabledReason ||
                (isPipEnabled ? 'Exit Picture in Picture' : 'Picture in Picture')
            "
            :aria-label="isPipEnabled ? 'Exit picture in picture' : 'Enter picture in picture'"
            @click.stop="onTogglePip"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 -960 960 960"
                fill="currentColor"
                aria-hidden="true"
            >
                <path
                    v-if="isPipEnabled"
                    d="M160-160q-33 0-56.5-23.5T80-240v-280h80v280h640v-480H440v-80h360q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm523-140 57-57-124-123h104v-80H480v240h80v-103l123 123ZM80-600v-200h280v200H80Zm400 120Z"
                />
                <path
                    v-else
                    d="M80-520v-80h144L52-772l56-56 172 172v-144h80v280H80Zm80 360q-33 0-56.5-23.5T80-240v-200h80v200h320v80H160Zm640-280v-280H440v-80h360q33 0 56.5 23.5T880-720v280h-80ZM560-160v-200h320v200H560Z"
                />
            </svg>
        </button>

        <button
            v-if="!(isWindowsPlatform && isPipEnabled)"
            class="icon-button icon-button--player icon-button--lg"
            :class="{ 'icon-button--disabled': isMacPlatform && isPipEnabled }"
            :disabled="isMacPlatform && isPipEnabled"
            :aria-disabled="isMacPlatform && isPipEnabled"
            @click="emit('toggle-fullscreen')"
        >
            <svg
                v-if="!isFullscreen"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
            >
                <path
                    d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
                ></path>
            </svg>
            <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
            >
                <path
                    d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
                ></path>
            </svg>
        </button>
    </div>
</template>

<style scoped>
.icon-button--lg.pip-toggle svg {
    width: 26px !important;
    height: 26px !important;
}

.pip-toggle--active {
    color: #8fb3ff;
}

.track-menu__header-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.track-menu__title-group {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.track-menu__back-button {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    transition:
        color 0.2s,
        transform 0.1s;
}

.track-menu__back-button:hover {
    background: transparent;
    color: #ccc;
}

.track-menu__back-button:active {
    transform: none;
}

.track-menu__back-button svg {
    width: 22px;
    height: 22px;
    transition: transform 0.1s;
}

.track-menu__back-button:hover svg {
    transform: scale(1.1);
}

.track-menu__back-button:active svg {
    transform: scale(0.95);
}

.track-menu__header-action--compact svg {
    width: 21px;
    height: 21px;
    transform: none;
}

.track-menu__header-action--compact {
    width: 26px;
    height: 26px;
}

.track-menu__dual-button {
    height: 24px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.78);
    padding: 0 8px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition:
        background-color 0.2s ease,
        border-color 0.2s ease,
        color 0.2s ease;
}

.track-menu__dual-button:hover {
    background: rgba(255, 255, 255, 0.11);
    color: rgba(255, 255, 255, 0.94);
}

.track-menu__dual-button--active {
    background: rgba(143, 179, 255, 0.22);
    border-color: rgba(143, 179, 255, 0.75);
    color: #dfeaff;
}

.track-menu__mode-toggle {
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.92);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 8px;
    padding: 4px 6px;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.track-menu__mode-toggle:hover {
    background: rgba(255, 255, 255, 0.1);
}

.track-menu__mode-label {
    font-size: 12px;
    font-weight: 600;
}

.track-menu__mode-switch {
    width: 26px;
    height: 12px;
    background: rgba(255, 255, 255, 0.28);
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    padding: 2px;
    transition: background-color 0.2s ease;
}

.track-menu__mode-switch--on {
    background: #8fb3ff;
}

.track-menu__mode-thumb {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff;
    transform: translateX(0);
    transition: transform 0.2s ease;
}

.track-menu__mode-switch--on .track-menu__mode-thumb {
    transform: translateX(12px);
}

.track-menu__item--audio {
    align-items: center;
    padding-top: 11px;
    padding-bottom: 11px;
    width: max-content;
    min-width: 100%;
    max-width: 360px;
}

.track-menu--audio {
    width: max-content;
    min-width: 240px;
    max-width: 360px;
}

.track-menu__item--audio .track-menu__check {
    margin-top: 0;
}

.track-menu__text--audio {
    min-width: 0;
    width: 100%;
    max-width: calc(360px - 68px);
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: normal;
}

.track-menu__audio-title {
    min-width: 0;
    flex: 1;
    color: rgba(255, 255, 255, 0.94);
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.track-menu__audio-details {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    margin-left: auto;
    flex: 0 1 auto;
}

.track-menu__audio-detail {
    max-width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 5px;
    padding: 2px 5px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.72);
    font-size: 11px;
    line-height: 1.15;
    overflow-wrap: anywhere;
}

.track-menu__item--subtitle {
    align-items: center;
    min-width: 0;
}

.track-menu__text--subtitle {
    min-width: 0;
    width: 100%;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: normal;
}

.track-menu__subtitle-title {
    min-width: 0;
    flex: 1;
    color: rgba(255, 255, 255, 0.94);
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.track-menu__subtitle-details {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    margin-left: auto;
    flex: 0 1 auto;
}

.track-menu__subtitle-detail {
    max-width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 5px;
    padding: 2px 5px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.72);
    font-size: 11px;
    line-height: 1.15;
    overflow-wrap: anywhere;
}

.track-menu__section + .track-menu__section {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.track-menu__sub-targets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 8px 14px 4px;
}

.track-menu__sub-target {
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.78);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition:
        background-color 0.2s ease,
        border-color 0.2s ease,
        color 0.2s ease;
}

.track-menu__sub-target:hover {
    background: rgba(255, 255, 255, 0.11);
}

.track-menu__sub-target--active {
    background: rgba(143, 179, 255, 0.22);
    border-color: rgba(143, 179, 255, 0.75);
    color: #dfeaff;
}

.track-menu__item--disabled {
    color: rgba(255, 255, 255, 0.36);
    cursor: not-allowed;
}

.track-menu__item--disabled:hover {
    background: transparent;
}

.track-menu__item--disabled .track-menu__check svg {
    opacity: 0.35;
}

.track-menu__section-label {
    padding: 8px 16px 4px;
    color: rgba(255, 255, 255, 0.66);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
}

.video-settings {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
}

.video-settings__tabs {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    padding: 0 10px 10px;
}

.video-settings__tab {
    position: relative;
    min-height: 30px;
    padding: 5px 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    text-align: center;
    cursor: pointer;
    transition:
        color 0.18s ease,
        background-color 0.18s ease,
        border-color 0.18s ease;
}

.video-settings__tab:hover {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.92);
}

.video-settings__tab--active {
    color: #8fb3ff;
}

.video-settings__tab--active::after {
    position: absolute;
    bottom: -5px;
    left: 50%;
    width: 0;
    height: 0;
    border-right: 5px solid transparent;
    border-bottom: 6px solid rgba(255, 255, 255, 0.92);
    border-left: 5px solid transparent;
    content: "";
    transform: translateX(-50%);
}

.video-settings__content {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
}

.framing-ratio-control {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.framing-ratio-control__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: rgba(255, 255, 255, 0.82);
    font-size: 12px;
}

.track-menu--video-settings
    .framing-ratio-control
    .panel__crop-preset--active {
    background: rgba(143, 179, 255, 0.22) !important;
    border-color: rgba(143, 179, 255, 0.75) !important;
    color: #dfeaff !important;
}

.track-menu--video-settings {
    width: min(340px, calc(100vw - 24px));
    max-height: min(430px, calc(100vh - 90px));
}

.track-menu--video-settings > .track-menu__header {
    margin-bottom: 0;
}

@media (max-width: 520px) {
    .video-settings__tabs {
        padding: 0 8px 8px;
    }

    .video-settings__tab {
        padding: 5px 10px;
        font-size: 11px;
    }
}

.track-menu__footer {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.track-menu--subtitle {
    min-width: 320px;
    width: min(360px, calc(100vw - 24px));
    max-width: calc(100vw - 24px);
}

.track-menu--subtitle-advanced {
    min-width: 300px;
}

.track-menu--subtitle .track-menu__header {
    padding-left: 8px;
    gap: 6px;
}

.track-menu__list--subtitle-advanced {
    padding-bottom: 2px;
}

.subtitle-advanced {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 10px 14px 14px;
}

.subtitle-advanced__field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: rgba(255, 255, 255, 0.82);
    font-size: 12px;
}

.subtitle-advanced__field--inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.subtitle-advanced__field--inline .subtitle-advanced__input {
    width: 170px;
}

.subtitle-advanced__input {
    height: 30px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.94);
    padding: 0 9px;
    font-size: 12px;
    outline: none;
}

.subtitle-advanced__input:focus {
    border-color: rgba(143, 179, 255, 0.75);
    background: rgba(255, 255, 255, 0.12);
}

.subtitle-advanced__select {
    cursor: pointer;
}

.subtitle-advanced__color-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.subtitle-advanced__color {
    width: 34px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: transparent;
    padding: 2px;
    cursor: pointer;
}

.subtitle-advanced__color-value {
    color: rgba(255, 255, 255, 0.92);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
}

.subtitle-advanced__reset {
    height: 30px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.86);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition:
        background-color 0.2s ease,
        border-color 0.2s ease,
        color 0.2s ease;
}

.subtitle-advanced__reset:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.24);
    color: #fff;
}
</style>
