<script setup lang="ts">
import { isTauri } from "@/features/player/soia/native";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText, writeText } from "@/features/player/soia/clipboard";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import ContextMenu from "./ContextMenu.vue";
import CastDevicePopover from "./CastDevicePopover.vue";
import type { MediaInfo } from "../mock/mediaInfo";
import {
    SETTINGS_UPDATED_EVENT,
    type PlaybackTitleMode,
} from "../mock/settings";
import type { BoxPlayer } from "../types/media";
import { applyRenderingSettings, loadUiState } from "../composables/useUiStateStore";
import { getPathDisplayName } from "../utils/getPathDisplayName";
import { getPlaybackDisplayPathWithHomePrefix } from "../utils/playbackDisplay";

const props = defineProps<{
    isMacOs: boolean;
    url: string;
    mediaTitle: string;
    isUrlModified: boolean;
    isFileLoaded: boolean;
    isInfoOpen: boolean;
    isPlaylistOpen: boolean;
    isLoading: boolean;
    playbackTitleMode: PlaybackTitleMode;
    compactModeEnabled: boolean;
    isFullscreen: boolean;
    info: MediaInfo | null;
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    videoBitrate: number;
    hwdecCurrent: string;
    playbackSpeed: number;
    videoTracks: BoxPlayer[];
    audioTracks: BoxPlayer[];
    subTracks: BoxPlayer[];
}>();

const emit = defineEmits<{
    (e: "update:url", value: string): void;
    (e: "load-file"): void;
    (e: "open-file-picker"): void;
    (e: "toggle-info"): void;
    (e: "toggle-playlist"): void;
    (e: "cast-popover-toggle", value: boolean): void;
    (e: "url-input-mousedown", event: MouseEvent): void;
    (e: "url-input-touchstart", event: TouchEvent): void;
}>();

const isWindowsPlatform =
    typeof navigator !== "undefined" && /\bwindows\b/i.test(navigator.userAgent);
const isAndroidPlatform =
    typeof navigator !== "undefined" && /\bandroid\b/i.test(navigator.userAgent);
const isLinuxPlatform =
    typeof navigator !== "undefined" && /\blinux\b/i.test(navigator.userAgent);
const isDesktopCompactControlsPlatform =
    isWindowsPlatform || (isLinuxPlatform && !isAndroidPlatform);
const isMacPlatform =
    typeof navigator !== "undefined" && /mac|darwin/i.test(navigator.userAgent);
const shouldReserveMacTrafficLightsSpace = computed(
    () => (props.isMacOs || isMacPlatform) && props.compactModeEnabled,
);
const isWindowMaximized = ref(false);
const showDesktopCompactControls = computed(
    () =>
        isDesktopCompactControlsPlatform &&
        props.compactModeEnabled &&
        !props.isFullscreen,
);

type StoredRenderingState = {
    renderingMode?: "normal" | "animeMode" | "animeAuto";
    selectedShaderFiles?: string[];
    activeShaderFiles?: string[];
    animeModeEnabled?: boolean;
    animeAutoShaderEnabled?: boolean;
    normalSelectedShaderFiles?: string[];
    normalActiveShaderFiles?: string[];
    animeModeSelectedShaderFiles?: string[];
    animeModeActiveShaderFiles?: string[];
    animeSelectedShaderFiles?: string[];
    animeActiveShaderFiles?: string[];
};

type ContextMenuItem = {
    id: string;
    label: string;
    disabled?: boolean;
};

const refreshWindowMaximizedState = async () => {
    if (!isDesktopCompactControlsPlatform) return;
    try {
        isWindowMaximized.value = await getCurrentWindow().isMaximized();
    } catch {
        // Ignore in non-Tauri environments.
    }
};

const onWindowMinimize = async () => {
    try {
        await getCurrentWindow().minimize();
    } catch {
        // Ignore in non-Tauri environments.
    }
};

const onWindowToggleMaximize = async () => {
    try {
        const currentWindow = getCurrentWindow();
        if (isWindowMaximized.value) {
            await currentWindow.unmaximize();
            isWindowMaximized.value = false;
        } else {
            await currentWindow.maximize();
            isWindowMaximized.value = true;
        }
    } catch {
        // Ignore in non-Tauri environments.
    }
};

const onWindowClose = async () => {
    try {
        await getCurrentWindow().close();
    } catch {
        // Ignore in non-Tauri environments.
    }
};

let unlistenWindowResized: (() => void) | null = null;

onMounted(async () => {
    void refreshShaderNamesFromState();
    if (typeof window !== "undefined") {
        window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    }

    if (!isDesktopCompactControlsPlatform) return;
    await refreshWindowMaximizedState();
    try {
        unlistenWindowResized = await getCurrentWindow().onResized(() => {
            void refreshWindowMaximizedState();
        });
    } catch {
        // Ignore in non-Tauri environments.
    }
});

onUnmounted(() => {
    if (typeof window !== "undefined") {
        window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    }
    unlistenWindowResized?.();
    unlistenWindowResized = null;
});

const subtitleTracks = computed(() =>
    props.subTracks.filter((track) => Number(track.id) !== 0),
);
const isPlaybackTitleHidden = computed(
    () => props.playbackTitleMode === "Hidden" && props.isFileLoaded,
);
const isUrlInputLocked = computed(
    () => props.isFileLoaded && props.playbackTitleMode !== "Editable",
);
const isUrlInputFocused = ref(false);
const urlInputRef = ref<HTMLInputElement | null>(null);
const isUrlContextMenuOpen = ref(false);
const urlContextMenuPosition = ref({ x: 0, y: 0 });
const urlContextMenuSelection = ref({ start: 0, end: 0 });
const pendingUrlContextMenuSelection = ref<{ start: number; end: number } | null>(null);

const appendUrlExtensionToTitle = (title: string, url: string) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return normalizedTitle;
    if (/\.[a-z0-9]{1,8}$/i.test(normalizedTitle)) return normalizedTitle;
    const fileName = getPathDisplayName(url, "");
    const extensionMatch = fileName.match(/(\.[a-z0-9]{1,8})$/i);
    if (!extensionMatch) return normalizedTitle;
    return `${normalizedTitle}${extensionMatch[1]}`;
};

const isNetworkLikeUrl = (value: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());

const displayUrlInputValue = computed(() => {
    if (isUrlInputFocused.value) return props.url;

    const title = props.mediaTitle?.trim();
    const usePathDisplay =
        !isNetworkLikeUrl(props.url) ||
        props.url.trim().toLowerCase().startsWith("file://");

    if (usePathDisplay) {
        return getPlaybackDisplayPathWithHomePrefix(props.url);
    }

    if (props.isFileLoaded && title) {
        return appendUrlExtensionToTitle(title, props.url);
    }

    return getPlaybackDisplayPathWithHomePrefix(props.url);
});

const displayInfoFilePath = computed(() =>
    props.info ? getPlaybackDisplayPathWithHomePrefix(props.info.path) : "",
);
const displayInfoMediaTitle = computed(() => {
    const title = props.mediaTitle?.trim();
    if (title) return title;
    return displayInfoFilePath.value || "—";
});

const onUrlInputFocus = () => {
    isUrlInputFocused.value = true;
};

const onUrlInputBlur = () => {
    isUrlInputFocused.value = false;
};

const isUrlInputContextMenuMouseDown = (event: MouseEvent) =>
    event.button === 2 || event.ctrlKey;

const onUrlInputMouseDown = (event: MouseEvent) => {
    if (isUrlInputContextMenuMouseDown(event)) {
        const { start, end } = getUrlInputSelection();
        pendingUrlContextMenuSelection.value = { start, end };
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if (!isUrlInputLocked.value) return;
    event.preventDefault();
    emit("url-input-mousedown", event);
};

const onUrlInputTouchStart = (event: TouchEvent) => {
    if (!isUrlInputLocked.value) return;
    event.preventDefault();
    emit("url-input-touchstart", event);
};

const closeUrlContextMenu = () => {
    isUrlContextMenuOpen.value = false;
    pendingUrlContextMenuSelection.value = null;
};

const restoreUrlInputSelection = (selection: { start: number; end: number }) => {
    const input = urlInputRef.value;
    if (!input) return;
    input.setSelectionRange(selection.start, selection.end);
};

const onUrlInputContextMenu = (event: MouseEvent) => {
    if (isPlaybackTitleHidden.value) return;
    event.preventDefault();
    event.stopPropagation();
    isUrlInputFocused.value = true;
    urlInputRef.value?.focus({ preventScroll: true });

    const fallbackSelection = getUrlInputSelection();
    const selection = pendingUrlContextMenuSelection.value ?? {
        start: fallbackSelection.start,
        end: fallbackSelection.end,
    };
    restoreUrlInputSelection(selection);
    window.requestAnimationFrame(() => {
        restoreUrlInputSelection(selection);
    });
    urlContextMenuSelection.value = selection;
    urlContextMenuPosition.value = {
        x: event.clientX,
        y: event.clientY,
    };
    isUrlContextMenuOpen.value = true;
};

const getUrlInputSelection = () => {
    const input = urlInputRef.value;
    if (!input) return { input: null, start: 0, end: 0 };
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    return { input, start, end };
};

const writeClipboardText = async (value: string) => {
    if (!value) return;
    try {
        await writeText(value);
        return;
    } catch {
        // Fall back to the browser API when this component runs outside Tauri.
    }

    if (!isTauri() && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return;
        } catch {
            // Fall back to copying the current editable selection when clipboard access is blocked.
        }
    }

    document.execCommand("copy");
};

const updateUrlInputValue = (value: string, selectionStart: number) => {
    const input = urlInputRef.value;
    emit("update:url", value);
    if (!input) return;
    input.value = value;
    input.setSelectionRange(selectionStart, selectionStart);
};

const deleteUrlInputSelection = () => {
    if (isUrlInputLocked.value) return;
    const { input, start, end } = getUrlInputSelection();
    if (!input || start === end) return;
    updateUrlInputValue(`${input.value.slice(0, start)}${input.value.slice(end)}`, start);
    closeUrlContextMenu();
};

const copyUrlInputSelection = async () => {
    const { input, start, end } = getUrlInputSelection();
    if (!input) return;
    const selectedText = input.value.slice(start, end);
    await writeClipboardText(selectedText || input.value);
    closeUrlContextMenu();
};

const cutUrlInputSelection = async () => {
    if (isUrlInputLocked.value) return;
    const { input, start, end } = getUrlInputSelection();
    if (!input || start === end) return;
    await writeClipboardText(input.value.slice(start, end));
    updateUrlInputValue(`${input.value.slice(0, start)}${input.value.slice(end)}`, start);
    closeUrlContextMenu();
};

const pasteUrlInputClipboard = async () => {
    if (isUrlInputLocked.value) return;
    const { input, start, end } = getUrlInputSelection();
    if (!input) return;
    closeUrlContextMenu();

    let text = "";
    try {
        text = await readText();
    } catch {
        if (!isTauri() && navigator.clipboard?.readText) {
            try {
                text = await navigator.clipboard.readText();
            } catch {
                text = "";
            }
        }
    }

    if (!text) {
        return;
    }

    const nextValue = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    updateUrlInputValue(nextValue, start + text.length);
};

const selectAllUrlInput = () => {
    urlInputRef.value?.focus({ preventScroll: true });
    urlInputRef.value?.select();
    closeUrlContextMenu();
};

const hasUrlContextMenuSelection = computed(
    () => urlContextMenuSelection.value.start !== urlContextMenuSelection.value.end,
);

const urlContextMenuItems = computed(() => {
    const items: ContextMenuItem[] = [
        { id: "copy", label: "Copy" },
    ];

    if (!isUrlInputLocked.value) {
        items.push(
            {
                id: "cut",
                label: "Cut",
                disabled: !hasUrlContextMenuSelection.value,
            },
            { id: "paste", label: "Paste" },
            {
                id: "delete",
                label: "Delete",
                disabled: !hasUrlContextMenuSelection.value,
            },
        );
    }

    items.push({ id: "select-all", label: "Select All" });
    return items;
});

const onUrlContextMenuSelect = (id: string) => {
    if (id === "copy") {
        void copyUrlInputSelection();
        return;
    }
    if (id === "cut") {
        void cutUrlInputSelection();
        return;
    }
    if (id === "paste") {
        void pasteUrlInputClipboard();
        return;
    }
    if (id === "delete") {
        deleteUrlInputSelection();
        return;
    }
    if (id === "select-all") {
        selectAllUrlInput();
    }
};

const selectedVideoTrack = computed(() =>
    props.videoTracks.find((track) => track.selected),
);
const selectedAudioTrack = computed(() =>
    props.audioTracks.find((track) => track.selected),
);
const selectedSubTrack = computed(() =>
    subtitleTracks.value.find((track) => track.selected),
);
const hasVideoSection = computed(() => props.videoTracks.length > 0);
const hasAudioSection = computed(() => props.audioTracks.length > 0);
const hasSubtitleSection = computed(() => subtitleTracks.value.length > 0);

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

const formatPlaybackTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "00:00:00";
    }
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600)
        .toString()
        .padStart(2, "0");
    const minutes = Math.floor((total % 3600) / 60)
        .toString()
        .padStart(2, "0");
    const secs = Math.floor(total % 60)
        .toString()
        .padStart(2, "0");
    return `${hours}:${minutes}:${secs}`;
};

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const formatFps = (fps?: number | null, fallback?: string) => {
    if (typeof fps === "number" && Number.isFinite(fps) && fps > 0) {
        return `${fps.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")} fps`;
    }
    return fallback ?? "Unknown fps";
};

const formatBitrate = (bitrate?: number | null, fallback?: string) => {
    if (typeof bitrate === "number" && Number.isFinite(bitrate) && bitrate > 0) {
        if (bitrate >= 1_000_000) {
            return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
        }
        if (bitrate >= 1_000) {
            return `${Math.round(bitrate / 1_000)} kbps`;
        }
        return `${bitrate} bps`;
    }
    return fallback ?? "Unknown bitrate";
};

const formatSampleRate = (sampleRate?: number | null, fallback?: string) => {
    if (
        typeof sampleRate === "number" &&
        Number.isFinite(sampleRate) &&
        sampleRate > 0
    ) {
        return `${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz`;
    }
    return fallback ?? "Unknown sample rate";
};

const formatResolution = (
    track?: BoxPlayer,
    fallback = "Unknown resolution",
) => {
    const width = track?.w ?? track?.demux_w;
    const height = track?.h ?? track?.demux_h;
    if (
        typeof width === "number" &&
        width > 0 &&
        typeof height === "number" &&
        height > 0
    ) {
        return `${width}x${height}`;
    }
    return fallback;
};

const getTrackDisplayName = (
    track?: BoxPlayer,
    options?: { allowLangFallback?: boolean },
) => {
    if (!track) return "";
    const title = track.title?.trim();
    const hasUsefulTitle = Boolean(title) && !/^unknown$/i.test(title ?? "");
    if (hasUsefulTitle) return title ?? "";
    if (options?.allowLangFallback) {
        return track.lang?.trim() || "";
    }
    return "";
};

const formatTrackIdTag = (track: BoxPlayer, kind: "aid" | "vid" | "sid") =>
    `[${kind}=${track.id}]`;

const formatDecoder = (track?: BoxPlayer) => {
    const decoder = track?.decoder_desc?.trim();
    return decoder ? `Decoder ${decoder}` : null;
};

const formatHwdecCurrent = (value?: string) => {
    const normalized = value?.trim().toLowerCase() ?? "";
    if (!normalized || normalized === "no") {
        return "SW";
    }
    return `HW(${value?.trim() ?? ""})`;
};

const playbackLine = computed(() => {
    const duration = Math.max(0, props.duration || 0);
    const currentTime = clamp(props.currentTime || 0, 0, duration || 0);
    const progress = duration > 0 ? currentTime / duration : 0;
    const state = props.isPlaying ? "Playing" : "Paused";
    const hwdec = formatHwdecCurrent(props.hwdecCurrent);
    return `${state} | ${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)} (${formatPercent(progress)}) | ${props.playbackSpeed.toFixed(2)}x | ${hwdec}`;
});

const videoCodecLine = computed(() => {
    const track = selectedVideoTrack.value;
    const codec = track?.codec || track?.codec_desc || props.info?.video.codec || "Unknown codec";
    const decoder = formatDecoder(track);
    return [codec, decoder].filter(Boolean).join(" | ");
});

const videoDetailLine = computed(() => {
    const track = selectedVideoTrack.value;
    const resolution = formatResolution(track, props.info?.video.resolution || "Unknown resolution");
    const fps = formatFps(track?.fps ?? track?.demux_fps, props.info?.video.fps);
    const trackBitrate =
        typeof track?.demux_bitrate === "number" && track.demux_bitrate > 0
            ? formatBitrate(track.demux_bitrate)
            : undefined;
    const bitrate = formatBitrate(props.videoBitrate, trackBitrate);
    const color = props.info?.video.color || "Unknown color";
    const aspect = props.info?.video.aspect ? `AR ${props.info.video.aspect}` : null;
    return [resolution, fps, bitrate, color, aspect].filter(Boolean).join(" | ");
});

const audioCodecLine = computed(() => {
    const track = selectedAudioTrack.value;
    const codec = track?.codec || track?.codec_desc || props.info?.audio.codec || "Unknown codec";
    const decoder = formatDecoder(track);
    return [codec, decoder].filter(Boolean).join(" | ");
});

const videoTrackTag = computed(() => {
    const track = selectedVideoTrack.value;
    return track ? formatTrackIdTag(track, "vid") : "[vid=?]";
});

const audioTrackTag = computed(() => {
    const track = selectedAudioTrack.value;
    return track ? formatTrackIdTag(track, "aid") : "[aid=?]";
});

const audioDetailLine = computed(() => {
    const track = selectedAudioTrack.value;
    const channels = track?.demux_channels || props.info?.audio.channels || "Unknown channels";
    const sampleRate = formatSampleRate(track?.demux_samplerate, props.info?.audio.sampleRate);
    const bitrate = formatBitrate(track?.demux_bitrate);
    const language = track?.lang?.trim() || "";
    const trackName = getTrackDisplayName(track, { allowLangFallback: false });
    const shouldShowTrackName =
        Boolean(trackName) &&
        trackName.toLowerCase() !== language.trim().toLowerCase();
    return [channels, sampleRate, bitrate, language, shouldShowTrackName ? trackName : ""]
        .filter(
            (value, index) =>
                value && (index !== 2 || value !== "Unknown bitrate"),
        )
        .join(" | ");
});

const subtitleTrackTag = computed(() => {
    const track = selectedSubTrack.value;
    return track ? formatTrackIdTag(track, "sid") : "";
});

const subtitleTrackName = computed(() =>
    getTrackDisplayName(selectedSubTrack.value, { allowLangFallback: true }),
);

const configuredSelectedShaderPaths = ref<string[]>([]);
const configuredActiveShaderPaths = ref<string[]>([]);
const configuredActiveShaderNames = ref<string[]>([]);
const isPlaybackShaderEnabled = ref(false);
const isPlaybackShaderToggleBusy = ref(false);
const renderingMode = ref<"normal" | "animeMode">("normal");

const shaderDisplayNameFromPath = (path: string) => {
    const normalized = path.trim();
    if (!normalized) return "";
    const displayName = getPathDisplayName(normalized, normalized);
    return displayName.replace(/\.glsl$/i, "");
};

const updateActiveShaderNames = (paths?: string[]) => {
    const uniqueNames: string[] = [];
    (paths ?? []).forEach((path) => {
        const name = shaderDisplayNameFromPath(path);
        if (!name) return;
        if (!uniqueNames.includes(name)) {
            uniqueNames.push(name);
        }
    });
    configuredActiveShaderNames.value = uniqueNames;
};

const setRenderingStateFromStored = (rendering?: StoredRenderingState) => {
    const resolvedMode: "normal" | "animeMode" =
        rendering?.renderingMode === "animeMode" ||
        rendering?.renderingMode === "animeAuto" ||
        rendering?.animeModeEnabled === true ||
        rendering?.animeAutoShaderEnabled === true
            ? "animeMode"
            : "normal";
    renderingMode.value = resolvedMode;

    const sharedSelected = rendering?.selectedShaderFiles ?? [];
    const legacyActive = rendering?.activeShaderFiles ?? [];
    const fallbackSelected = [
        ...(rendering?.normalSelectedShaderFiles ?? []),
        ...(rendering?.animeModeSelectedShaderFiles ?? []),
        ...(rendering?.animeSelectedShaderFiles ?? []),
    ];
    const selected = (sharedSelected.length ? sharedSelected : fallbackSelected)
        .map((path) => path.trim())
        .filter((path) => Boolean(path));
    const normalActive =
        rendering?.normalActiveShaderFiles ??
        (resolvedMode === "normal" ? legacyActive : []);
    const animeActive =
        rendering?.animeModeActiveShaderFiles ??
        rendering?.animeActiveShaderFiles ??
        (resolvedMode === "animeMode" ? legacyActive : []);

    configuredSelectedShaderPaths.value = selected;
    configuredActiveShaderPaths.value =
        resolvedMode === "normal" ? normalActive : animeActive;
    updateActiveShaderNames(configuredActiveShaderPaths.value);
};

const refreshShaderNamesFromState = async () => {
    const stored = await loadUiState<{
        rendering?: StoredRenderingState;
    }>();
    setRenderingStateFromStored(stored?.rendering);
    isPlaybackShaderEnabled.value = resolvePlaybackShaderEnabledState();
};

const onSettingsUpdated = (event: Event) => {
    const customEvent = event as CustomEvent<{
        rendering?: StoredRenderingState;
    }>;
    const nextRendering = customEvent.detail?.rendering;
    if (!nextRendering) {
        void refreshShaderNamesFromState();
        return;
    }
    setRenderingStateFromStored(nextRendering);
    isPlaybackShaderEnabled.value = resolvePlaybackShaderEnabledState();
};

const canTogglePlaybackShader = computed(
    () => props.isFileLoaded && configuredActiveShaderPaths.value.length > 0,
);

const applyPlaybackShaderState = async (enabled: boolean): Promise<boolean> => {
    const applied = await applyRenderingSettings(
        configuredSelectedShaderPaths.value,
        enabled ? configuredActiveShaderPaths.value : [],
    );
    if (!applied) return false;
    isPlaybackShaderEnabled.value = enabled && applied.activeShaderFiles.length > 0;
    return true;
};

const onPlaybackShaderToggle = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const nextEnabled = input.checked;
    if (isPlaybackShaderToggleBusy.value) return;
    if (!canTogglePlaybackShader.value) {
        input.checked = isPlaybackShaderEnabled.value;
        return;
    }

    isPlaybackShaderToggleBusy.value = true;
    const ok = await applyPlaybackShaderState(nextEnabled);
    if (!ok) {
        input.checked = isPlaybackShaderEnabled.value;
    }
    isPlaybackShaderToggleBusy.value = false;
};

const shaderLine = computed(() => {
    return `Shader: ${configuredActiveShaderNames.value.join(" + ")}`;
});

const ANIME_DETECT_KEYWORDS = [
    "/anime/",
    "\\anime\\",
    "anime",
    "donghua",
    "cartoon",
    "animation",
    "3d_anime",
    "動漫",
    "动漫",
    "番剧",
    "新番",
    "ani-one",
    "aniplus",
    "crunchyroll",
];

const LIVE_ACTION_KEYWORDS = [
    "live action",
    "live-action",
    "liveaction",
    "drama",
    "real person",
];

const ANIME_CRC_PATTERN = /\[[0-9a-f]{8}\]/i;
const ANIME_RELEASE_GROUP_PATTERN = /\[[^\]]+\]/;

const isLikelyAnimeMedia = (input: string) => {
    const normalized = input.trim().toLowerCase();
    if (!normalized) return false;
    return ANIME_DETECT_KEYWORDS.some((keyword) =>
        normalized.includes(keyword.toLowerCase()),
    );
};

const hasLiveActionSignal = () => {
    const searchStr = `${props.url ?? ""} ${props.mediaTitle ?? ""}`.toLowerCase();
    return LIVE_ACTION_KEYWORDS.some((keyword) => searchStr.includes(keyword));
};

const hasAnimeCrcSignal = () => {
    const searchStr = `${props.url ?? ""} ${props.mediaTitle ?? ""}`;
    return ANIME_CRC_PATTERN.test(searchStr);
};

const hasAnimeReleaseSyntaxSignal = () => {
    const title = props.mediaTitle ?? "";
    return ANIME_RELEASE_GROUP_PATTERN.test(title);
};

const hasJapaneseAudioSignal = () =>
    props.audioTracks.some((track) => {
        const lang = track.lang?.trim().toLowerCase();
        return lang === "ja" || lang === "jpn";
    });

const shouldEnableShaderForCurrentMedia = () => {
    if (!configuredActiveShaderPaths.value.length) return false;
    if (renderingMode.value === "normal") return true;

    // Keep the same priority as mpv-anime-build auto mode:
    // live-action override > CRC super-signal > standard anime signals.
    if (hasLiveActionSignal()) return false;
    if (hasAnimeCrcSignal()) return true;
    return (
        isLikelyAnimeMedia(props.mediaTitle ?? "") ||
        isLikelyAnimeMedia(props.url ?? "") ||
        hasAnimeReleaseSyntaxSignal() ||
        hasJapaneseAudioSignal()
    );
};

const resolvePlaybackShaderEnabledState = () => {
    if (!configuredActiveShaderPaths.value.length) return false;
    if (!props.isFileLoaded || !props.url) return true;
    return shouldEnableShaderForCurrentMedia();
};

watch(
    () =>
        [
            props.isFileLoaded,
            props.url,
            props.mediaTitle,
            props.audioTracks.map((track) => track.lang ?? "").join("\n"),
            renderingMode.value,
            configuredSelectedShaderPaths.value.join("\n"),
            configuredActiveShaderPaths.value.join("\n"),
        ] as const,
    (
        [
            isFileLoaded,
            nextUrl,
            nextTitle,
            nextAudioLangsKey,
            ,
            nextSelectedKey,
            nextActiveKey,
        ],
        [
            prevLoaded,
            prevUrl,
            prevTitle,
            prevAudioLangsKey,
            prevMode,
            prevSelectedKey,
            prevActiveKey,
        ],
    ) => {
        if (!isFileLoaded || !nextUrl) return;
        const isNewMedia = !prevLoaded || prevUrl !== nextUrl;
        const titleChanged = nextTitle !== prevTitle;
        const audioLangsChanged = nextAudioLangsKey !== prevAudioLangsKey;
        const modeChanged = renderingMode.value !== prevMode;
        const shaderConfigChanged =
            nextSelectedKey !== prevSelectedKey ||
            nextActiveKey !== prevActiveKey;
        const animeRetestNeeded =
            renderingMode.value === "animeMode" &&
            (titleChanged || audioLangsChanged);
        if (
            !isNewMedia &&
            !modeChanged &&
            !animeRetestNeeded &&
            !shaderConfigChanged
        ) {
            return;
        }

        const shouldEnable = shouldEnableShaderForCurrentMedia();
        isPlaybackShaderEnabled.value = shouldEnable;
        void applyPlaybackShaderState(shouldEnable);
    },
);

</script>

<template>
    <div
        class="top-bar"
        :class="{
            'top-bar--compact': props.compactModeEnabled,
            'top-bar--compact-macos': shouldReserveMacTrafficLightsSpace,
            'top-bar--compact-non-playback':
                props.compactModeEnabled && !props.isFileLoaded,
            'top-bar--fullscreen': props.isFullscreen,
        }"
    >
        <form class="top-bar__row" @submit.prevent="emit('load-file')">
            <div class="top-bar__content">
                <button
                    v-if="!props.compactModeEnabled || props.isFileLoaded"
                    class="icon-button top-bar__info"
                    :class="{ 'top-bar__info--active': props.isInfoOpen }"
                    type="button"
                    title="Info (I)"
                    :disabled="!props.isFileLoaded"
                    :aria-disabled="!props.isFileLoaded"
                    :aria-pressed="props.isInfoOpen"
                    @click="emit('toggle-info')"
                >
                    <svg
                        class="icon-outline"
                        xmlns="http://www.w3.org/2000/svg"
                        height="24px"
                        viewBox="0 -960 960 960"
                        width="24px"
                        fill="currentColor"
                    >
                        <path
                            d="M440-280h80v-240h-80v240Zm68.5-331.5Q520-623 520-640t-11.5-28.5Q497-680 480-680t-28.5 11.5Q440-657 440-640t11.5 28.5Q463-600 480-600t28.5-11.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"
                        />
                    </svg>
                </button>
                <button
                    class="icon-button top-bar__playlist"
                    :class="{ 'top-bar__playlist--active': props.isPlaylistOpen }"
                    type="button"
                    title="Playlist"
                    :aria-pressed="props.isPlaylistOpen"
                    @click="emit('toggle-playlist')"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                    >
                        <path
                            d="M4 6h12v2H4V6zm0 5h12v2H4v-2zm0 5h8v2H4v-2zm14-6h2v6.17l1.59-1.58L23 16l-4 4-4-4 1.41-1.41L18 16.17V10z"
                        />
                    </svg>
                </button>
                <input
                    ref="urlInputRef"
                    class="top-bar__input"
                    :class="{
                        'top-bar__input--loading': props.isLoading,
                        'top-bar__input--readonly': isUrlInputLocked,
                        'top-bar__input--hidden': isPlaybackTitleHidden,
                    }"
                    :value="displayUrlInputValue"
                    :readonly="isUrlInputLocked"
                    placeholder="Enter a video URL or select files..."
                    @mousedown.capture="onUrlInputMouseDown"
                    @touchstart="onUrlInputTouchStart"
                    @contextmenu="onUrlInputContextMenu"
                    @focus="onUrlInputFocus"
                    @blur="onUrlInputBlur"
                    @input="
                        emit(
                            'update:url',
                            ($event.target as HTMLInputElement).value,
                        )
                    "
                />
                <ContextMenu
                    :open="isUrlContextMenuOpen"
                    :x="urlContextMenuPosition.x"
                    :y="urlContextMenuPosition.y"
                    :items="urlContextMenuItems"
                    @select="onUrlContextMenuSelect"
                    @close="closeUrlContextMenu"
                />

                <CastDevicePopover
                    :is-file-loaded="props.isFileLoaded"
                    @update:open="emit('cast-popover-toggle', $event)"
                />

                <button
                    v-if="props.isUrlModified"
                    class="icon-button top-bar__action"
                    type="submit"
                    title="Play"
                    :disabled="props.isLoading"
                    :aria-disabled="props.isLoading"
                >
                    <svg
                        class="icon-outline icon-outline-play"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path d="M8 5v14l11-7z" />
                    </svg>
                </button>

                <button
                    v-else
                    class="icon-button top-bar__action"
                    type="button"
                    @click="emit('open-file-picker')"
                    title="Open File"
                >
                    <svg
                        class="icon-outline"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path
                            d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                        ></path>
                    </svg>
                </button>

                <div
                    v-if="showDesktopCompactControls"
                    class="top-bar__window-controls"
                    data-window-no-drag
                >
                    <button
                        class="top-bar__window-control top-bar__window-control--minimize"
                        type="button"
                        title="Minimize"
                        aria-label="Minimize window"
                        @click.stop="onWindowMinimize"
                    >
                        <svg viewBox="0 0 10 10" aria-hidden="true">
                            <line
                                x1="1.6"
                                y1="5.3"
                                x2="8.4"
                                y2="5.3"
                                stroke="currentColor"
                                stroke-width="1.2"
                                stroke-linecap="round"
                            />
                        </svg>
                    </button>
                    <button
                        class="top-bar__window-control top-bar__window-control--maximize"
                        type="button"
                        :title="isWindowMaximized ? 'Restore' : 'Maximize'"
                        :aria-label="
                            isWindowMaximized
                                ? 'Restore window'
                                : 'Maximize window'
                        "
                        @click.stop="onWindowToggleMaximize"
                    >
                        <svg
                            v-if="!isWindowMaximized"
                            viewBox="0 0 10 10"
                            aria-hidden="true"
                        >
                            <rect
                                x="1.6"
                                y="1.6"
                                width="6.8"
                                height="6.8"
                                rx="0.8"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.1"
                                stroke-linejoin="round"
                            />
                        </svg>
                        <svg v-else viewBox="0 0 10 10" aria-hidden="true">
                            <rect
                                x="3"
                                y="1.6"
                                width="5.4"
                                height="5.4"
                                rx="0.7"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1"
                                stroke-linejoin="round"
                            />
                            <rect
                                x="1.6"
                                y="3"
                                width="5.4"
                                height="5.4"
                                rx="0.7"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1"
                                stroke-linejoin="round"
                            />
                        </svg>
                    </button>
                    <button
                        class="top-bar__window-control top-bar__window-control--close"
                        type="button"
                        title="Close"
                        aria-label="Close window"
                        @click.stop="onWindowClose"
                    >
                        <svg viewBox="0 0 10 10" aria-hidden="true">
                            <line
                                x1="2.1"
                                y1="2.1"
                                x2="7.9"
                                y2="7.9"
                                stroke="currentColor"
                                stroke-width="1.2"
                                stroke-linecap="round"
                            />
                            <line
                                x1="7.9"
                                y1="2.1"
                                x2="2.1"
                                y2="7.9"
                                stroke="currentColor"
                                stroke-width="1.2"
                                stroke-linecap="round"
                            />
                        </svg>
                    </button>
                </div>
            </div>
            <div
                v-if="props.isInfoOpen && props.info"
                class="top-bar__info-panel ui-surface"
            >
                <div class="info-panel__title">Playback Info (I)</div>
                <div class="info-panel__meta">{{ props.info.title }}</div>

                <div class="info-panel__section">
                    <div class="info-panel__label">Playback</div>
                    <div class="info-panel__value">{{ playbackLine }}</div>
                    <div
                        v-if="configuredActiveShaderNames.length > 0"
                        class="info-panel__value info-panel__value--shader info-panel__value--shader-row"
                        :class="{
                            'info-panel__value--shader-disabled': !isPlaybackShaderEnabled,
                        }"
                    >
                        <span>{{ shaderLine }}</span>
                        <label class="info-panel__shader-toggle">
                            <input
                                class="info-panel__shader-toggle-input"
                                type="checkbox"
                                :checked="isPlaybackShaderEnabled"
                                :disabled="
                                    !canTogglePlaybackShader ||
                                    isPlaybackShaderToggleBusy
                                "
                                @change="onPlaybackShaderToggle"
                            />
                            <span class="info-panel__shader-toggle-track">
                                <span class="info-panel__shader-toggle-thumb"></span>
                            </span>
                        </label>
                    </div>
                </div>

                <div class="info-panel__section">
                    <div class="info-panel__label">General</div>
                    <div class="info-panel__kv">
                        <div class="info-panel__kv-key">Path</div>
                        <div class="info-panel__kv-value">{{ displayInfoFilePath }}</div>
                        <div class="info-panel__kv-key">Title</div>
                        <div class="info-panel__kv-value">{{ displayInfoMediaTitle }}</div>
                        <div class="info-panel__kv-key">Container</div>
                        <div class="info-panel__kv-value">
                            {{ props.info.container }} | {{ props.info.size }} | {{ props.info.duration }}
                        </div>
                    </div>
                </div>

                <div v-if="hasVideoSection" class="info-panel__section">
                    <div class="info-panel__label">Video</div>
                    <div class="info-panel__value">
                        <span class="info-panel__track-tag">{{ videoTrackTag }}</span>{{ videoCodecLine }}
                    </div>
                    <div class="info-panel__value info-panel__value--sub">
                        <span class="info-panel__track-tag info-panel__track-tag--ghost">
                            {{ videoTrackTag }}
                        </span>{{ videoDetailLine }}
                    </div>
                </div>

                <div v-if="hasAudioSection" class="info-panel__section">
                    <div class="info-panel__label">Audio</div>
                    <div class="info-panel__value">
                        <span class="info-panel__track-tag">{{ audioTrackTag }}</span>{{ audioCodecLine }}
                    </div>
                    <div class="info-panel__value info-panel__value--sub">
                        <span class="info-panel__track-tag info-panel__track-tag--ghost">
                            {{ audioTrackTag }}
                        </span>{{ audioDetailLine }}
                    </div>
                </div>

                <div v-if="hasSubtitleSection" class="info-panel__section">
                    <div class="info-panel__label">Subtitle</div>
                    <div class="info-panel__value">
                        <template v-if="subtitleTrackTag">
                            <span class="info-panel__track-tag">{{ subtitleTrackTag }}</span>{{ subtitleTrackName }}
                        </template>
                        <template v-else>Off</template>
                    </div>
                </div>
            </div>
        </form>
    </div>
</template>

<style scoped>
.top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    --top-bar-row-min-height: 0px;
    --top-bar-row-gap: 8px;
    --top-bar-row-padding-left: 8px;
    --top-bar-input-padding: 6px 4px;
    --top-bar-input-font-size: 1em;
    --top-bar-input-line-height: normal;
    --top-bar-input-margin-top: 0px;
    --top-bar-action-size: 32px;
    --top-bar-action-padding: 4px;
    --top-bar-action-margin-top: 0px;
    --top-bar-info-size: 32px;
    --top-bar-info-margin-top: 6px;
    --top-bar-info-margin-left: 0px;
    --top-bar-info-svg-size: 80%;
    --top-bar-info-icon-scale: 0.9;
    --top-bar-playlist-size: 36px;
    --top-bar-playlist-margin-top: 4px;
    --top-bar-playlist-svg-size: 90%;
    --top-bar-info-panel-top: 48px;
    --top-bar-info-panel-left: 8px;
    padding: 0 12px 8px 0;
    background: transparent;
    transition: opacity 0.3s;
    z-index: 100;
    pointer-events: auto;
}

.top-bar--compact {
    --top-bar-row-min-height: 28px;
    --top-bar-row-gap: 6px;
    --top-bar-row-padding-left: 8px;
    --top-bar-input-padding: 3px 4px;
    --top-bar-input-font-size: 0.88em;
    --top-bar-input-line-height: 1.2;
    --top-bar-input-margin-top: -2px;
    --top-bar-action-size: 28px;
    --top-bar-action-padding: 3px;
    --top-bar-action-margin-top: -1px;
    --top-bar-info-size: 30px;
    --top-bar-info-margin-top: -1px;
    --top-bar-info-margin-left: 0px;
    --top-bar-info-svg-size: 86%;
    --top-bar-info-icon-scale: 0.96;
    --top-bar-playlist-size: 31px;
    --top-bar-playlist-margin-top: -1px;
    --top-bar-playlist-svg-size: 96%;
    --top-bar-playlist-svg-offset-y: 0px;
    --top-bar-info-panel-top: 42px;
    --top-bar-info-panel-left: 8px;
}

.top-bar--compact-macos {
    --top-bar-row-padding-left: 70px;
    --top-bar-info-size: 32px;
    --top-bar-info-margin-top: 0px;
    --top-bar-playlist-size: 32px;
    --top-bar-playlist-margin-top: 0px;
    --top-bar-playlist-svg-size: 100%;
    --top-bar-playlist-svg-offset-y: 0px;
    --top-bar-info-panel-left: 72px;
}

.top-bar--compact.top-bar--compact-non-playback {
    --top-bar-row-min-height: 0px;
    --top-bar-input-padding: 6px 4px;
    --top-bar-input-font-size: 1em;
    --top-bar-input-line-height: normal;
    --top-bar-input-margin-top: 0px;
    --top-bar-action-size: 32px;
    --top-bar-action-padding: 4px;
    --top-bar-action-margin-top: 0px;
    --top-bar-playlist-size: 36px;
    --top-bar-playlist-margin-top: 4px;
    --top-bar-playlist-svg-size: 90%;
}

.top-bar--compact-macos.top-bar--fullscreen {
    --top-bar-row-padding-left: 8px;
    --top-bar-info-margin-left: 0px;
    --top-bar-info-margin-top: -1px;
    --top-bar-playlist-margin-top: -1px;
    --top-bar-info-panel-left: 8px;
}

.top-bar__row {
    width: 100%;
    min-height: var(--top-bar-row-min-height);
}

.top-bar__content {
    display: flex;
    width: 100%;
    box-sizing: border-box;
    gap: var(--top-bar-row-gap);
    align-items: center;
    padding-left: var(--top-bar-row-padding-left);
    padding-top: 0;
}

.top-bar__input {
    flex: 1;
    background-color: transparent;
    border: none;
    border-bottom: 1px solid #aaa;
    padding: var(--top-bar-input-padding);
    font-size: var(--top-bar-input-font-size);
    line-height: var(--top-bar-input-line-height);
    margin-top: var(--top-bar-input-margin-top);
    color: inherit;
    outline: none;
    transition: border-color 0.2s;
}

.top-bar__info + .top-bar__input,
.top-bar__playlist ~ .top-bar__input {
    margin-left: -4px;
}

.top-bar__info + .top-bar__playlist {
    margin-left: -14px;
}

.top-bar__input:focus {
    border-bottom-color: var(--focus-color);
}

.top-bar__input--loading {
    border-bottom-color: rgba(57, 108, 216, 0.45);
    background-image:
        linear-gradient(
            90deg,
            rgba(57, 108, 216, 0) 0%,
            rgba(57, 108, 216, 1) 50%,
            rgba(57, 108, 216, 0) 100%
        );
    background-size: 40% 2px;
    background-repeat: no-repeat;
    background-position: -40% 100%;
    animation: input-loading 6s ease-in-out infinite alternate;
}

.top-bar__input--readonly {
    border-bottom: none;
    background-image: none;
    animation: none;
    user-select: none;
    -webkit-user-select: none;
    caret-color: transparent;
    cursor: default;
}

.top-bar__input--hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
}

@keyframes input-loading {
    0% {
        background-position: -40% 100%;
    }
    100% {
        background-position: 140% 100%;
    }
}
.top-bar__action {
    padding: var(--top-bar-action-padding);
    margin-top: var(--top-bar-action-margin-top);
    color: white;
    transition:
        color 0.2s,
        transform 0.1s;
    width: var(--top-bar-action-size);
    height: var(--top-bar-action-size);
    position: relative;
}
.top-bar__action svg {
    width: 100%;
    height: 100%;
}
.top-bar__action .icon-outline {
    stroke-width: 1.5;
    transform: scale(0.9);
    transform-origin: center;
}
.top-bar__action .icon-outline-play {
    transform: scale(1.15);
}
.top-bar__action:hover {
    color: #ccc;
    transform: scale(1.1);
}
.top-bar__action:active {
    transform: scale(0.95);
}

.top-bar__info {
    margin-top: var(--top-bar-info-margin-top);
    margin-left: var(--top-bar-info-margin-left);
    color: white;
    transition:
        color 0.2s,
        transform 0.1s;
    width: var(--top-bar-info-size);
    height: var(--top-bar-info-size);
}
.top-bar__info svg {
    width: var(--top-bar-info-svg-size);
    height: var(--top-bar-info-svg-size);
}
.top-bar__info .icon-outline {
    stroke-width: 1.5;
    transform: scale(var(--top-bar-info-icon-scale));
    transform-origin: center;
}
.top-bar__info:hover {
    color: #ccc;
    transform: scale(1.1);
}
.top-bar__info:active {
    transform: scale(0.95);
}
.top-bar__info--active {
    color: #8fb3ff;
}
.top-bar__info:disabled,
.top-bar__info[aria-disabled="true"] {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}

.top-bar__action:disabled,
.top-bar__action[aria-disabled="true"] {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}

.top-bar__playlist {
    margin-top: var(--top-bar-playlist-margin-top);
    color: white;
    transition:
        color 0.2s,
        transform 0.1s;
    width: var(--top-bar-playlist-size);
    height: var(--top-bar-playlist-size);
}

.top-bar__playlist svg {
    width: var(--top-bar-playlist-svg-size);
    height: var(--top-bar-playlist-svg-size);
    transform: translateY(var(--top-bar-playlist-svg-offset-y));
}

.top-bar__playlist:hover {
    color: #ccc;
    transform: scale(1.1);
}

.top-bar__playlist:active {
    transform: scale(0.95);
}

.top-bar__playlist--active {
    color: #8fb3ff;
}

.top-bar__window-controls {
    margin-left: 2px;
    margin-right: -12px;
    margin-top: -4px;
    align-self: flex-start;
    display: inline-flex;
    align-items: stretch;
    border-radius: 6px;
    overflow: hidden;
    border: none;
    background: rgba(22, 25, 31, 0.36);
}

.top-bar__window-control {
    width: 34px;
    height: 26px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.88);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    transition:
        background-color 0.12s ease,
        color 0.12s ease;
}

.top-bar__window-control + .top-bar__window-control {
    border-left: none;
}

.top-bar__window-control svg {
    width: 10px;
    height: 10px;
    transform: translateY(1px);
}

.top-bar__window-control--minimize:hover,
.top-bar__window-control--maximize:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
}

.top-bar__window-control--close:hover {
    background: #c42b1c;
    color: #ffffff;
}

.top-bar__window-control:active {
    filter: brightness(0.92);
}

.top-bar__info-panel {
    position: absolute;
    top: var(--top-bar-info-panel-top);
    left: var(--top-bar-info-panel-left);
    width: min(560px, 94vw);
    max-height: min(72vh, 720px);
    overflow: auto;
    padding: 14px 16px;
    border-radius: 14px;
    color: #f8f8f8;
    border: 1px solid var(--glass-border);
    z-index: 120;
}

.info-panel__title {
    font-size: 14px;
    font-weight: 700;
}

.info-panel__meta {
    margin-top: 4px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
    word-break: break-word;
}

.info-panel__section {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.info-panel__label {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.6);
}

.info-panel__value {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.88);
    line-height: 1.5;
    word-break: break-word;
}

.info-panel__value--sub {
    color: rgba(255, 255, 255, 0.7);
}

.info-panel__value--shader {
    color: rgba(248, 220, 140, 0.95);
}

.info-panel__value--shader-disabled {
    color: rgba(255, 255, 255, 0.58);
}

.info-panel__value--shader-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.info-panel__shader-toggle {
    display: inline-flex;
    align-items: center;
    flex: none;
}

.info-panel__shader-toggle-input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

.info-panel__shader-toggle-track {
    width: 30px;
    height: 16px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.28);
    display: inline-flex;
    align-items: center;
    padding: 1px;
    box-sizing: border-box;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.info-panel__shader-toggle-thumb {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.92);
    transform: translateX(0);
    transition: transform 0.2s ease;
}

.info-panel__shader-toggle-input:checked + .info-panel__shader-toggle-track {
    background: rgba(248, 220, 140, 0.5);
    border-color: rgba(248, 220, 140, 0.9);
}

.info-panel__shader-toggle-input:checked + .info-panel__shader-toggle-track .info-panel__shader-toggle-thumb {
    transform: translateX(12px);
}

.info-panel__shader-toggle-input:disabled + .info-panel__shader-toggle-track {
    opacity: 0.42;
}

.info-panel__track-tag {
    display: inline-block;
    margin-right: 8px;
    font-variant-numeric: tabular-nums;
}

.info-panel__track-tag--ghost {
    visibility: hidden;
}

.info-panel__kv {
    display: grid;
    grid-template-columns: 74px 1fr;
    gap: 4px 8px;
}

.info-panel__kv-key {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.62);
    text-transform: uppercase;
}

.info-panel__kv-value {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.85);
    word-break: break-word;
}

:root[data-platform="android"] .top-bar__info-panel {
    width: min(400px, 72vw);
    max-height: min(62vh, 440px);
    padding: 9px 11px;
    border-radius: 10px;
}

:root[data-platform="android"] .info-panel__title {
    font-size: 12px;
}

:root[data-platform="android"] .info-panel__meta {
    margin-top: 2px;
    font-size: 10px;
}

:root[data-platform="android"] .info-panel__section {
    margin-top: 7px;
    gap: 2px;
}

:root[data-platform="android"] .info-panel__label,
:root[data-platform="android"] .info-panel__kv-key {
    font-size: 9px;
}

:root[data-platform="android"] .info-panel__value,
:root[data-platform="android"] .info-panel__kv-value {
    font-size: 10px;
    line-height: 1.35;
}

:root[data-platform="android"] .info-panel__kv {
    grid-template-columns: 58px 1fr;
    gap: 2px 6px;
}

:root[data-platform="android"] .info-panel__track-tag {
    margin-right: 6px;
}

:root[data-theme="light"] .top-bar__action,
:root[data-theme="light"] .top-bar__info,
:root[data-theme="light"] .top-bar__playlist {
    color: rgba(28, 38, 52, 0.9);
}

:root[data-theme="light"] .top-bar__action:hover,
:root[data-theme="light"] .top-bar__info:hover,
:root[data-theme="light"] .top-bar__playlist:hover {
    color: rgba(18, 28, 40, 1);
}

:root[data-theme="light"] .top-bar__info--active,
:root[data-theme="light"] .top-bar__playlist--active {
    color: #2f65c9;
}

:root[data-theme="light"] .top-bar__window-controls {
    background: rgba(245, 247, 250, 0.8);
}

:root[data-theme="light"] .top-bar__window-control {
    color: rgba(33, 44, 57, 0.88);
}

:root[data-theme="light"] .top-bar__window-control + .top-bar__window-control {
    border-left: none;
}

:root[data-theme="light"] .top-bar__window-control--minimize:hover,
:root[data-theme="light"] .top-bar__window-control--maximize:hover {
    background: rgba(27, 44, 64, 0.12);
    color: rgba(20, 32, 46, 0.95);
}
</style>
