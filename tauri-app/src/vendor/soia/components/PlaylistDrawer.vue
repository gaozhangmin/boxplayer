<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type {
    Playlist,
    PlaylistEntry,
    PlaylistScrollState,
    PlaylistLoopMode,
    PlaylistSortMode,
} from "../types/playlist";
import { FAVORITES_PLAYLIST_ID } from "../types/playlist";
import { getPathDisplayName } from "../utils/getPathDisplayName";
import { getPlaybackDisplayPathWithHomePrefix } from "../utils/playbackDisplay";

type PlaylistDrawerEntry = PlaylistEntry & {
    playedRatio?: number;
};

const props = defineProps<{
    open: boolean;
    playlists: Playlist[];
    activePlaylistId: string | null;
    activePlaylistName: string;
    widthRatio: number | null;
    scrollState: PlaylistScrollState;
    entries: PlaylistDrawerEntry[];
    currentUrl: string;
    isReady: boolean;
    loopMode: PlaylistLoopMode;
    sortMode: PlaylistSortMode;
    isLoopOne: boolean;
}>();

const emit = defineEmits<{
    (e: "close"): void;
    (e: "play", entry: PlaylistEntry): void;
    (e: "add"): void;
    (e: "toggle-loop"): void;
    (e: "toggle-sort"): void;
    (e: "clear"): void;
    (e: "remove", entry: PlaylistEntry): void;
    (e: "enter-playlist", playlistId: string): void;
    (e: "back"): void;
    (e: "rename-playlist", playlistId: string, name: string): void;
    (e: "delete-playlist", playlistId: string): void;
    (e: "move-playlist", fromPlaylistId: string, toPlaylistId: string): void;
    (e: "width-ratio-change", ratio: number): void;
    (e: "scroll-position-change", playlistId: string | null, scrollTop: number): void;
}>();

const MIN_DRAWER_WIDTH = 260;
const DEFAULT_DRAWER_WIDTH = 360;
const PLAYLIST_POINTER_DRAG_THRESHOLD_PX = 6;
const drawerWidth = ref(DEFAULT_DRAWER_WIDTH);
let resizeStartX = 0;
let resizeStartWidth = DEFAULT_DRAWER_WIDTH;
let isResizing = false;
const editingPlaylistId = ref<string | null>(null);
const preventNextActivatePlaylistId = ref<string | null>(null);
const skipPreventOnBlurPlaylistId = ref<string | null>(null);
const openedMenuPlaylistId = ref<string | null>(null);
const draggingPlaylistId = ref<string | null>(null);
const dragOverPlaylistId = ref<string | null>(null);
const swapLockTargetPlaylistId = ref<string | null>(null);
const playlistNameDrafts = ref<Record<string, string>>({});
const hasInitializedEditDraftById = ref<Record<string, boolean>>({});
const contentRef = ref<HTMLElement | null>(null);
let scrollSyncTimer: number | null = null;
let isRestoringScroll = false;
let activeDragPointerId: number | null = null;
let pointerDragStartX = 0;
let pointerDragStartY = 0;
let pendingPointerDragPlaylistId: string | null = null;
let isPointerSortingActive = false;
let activeDragSourceElement: HTMLElement | null = null;

const playlistItems = computed(() => props.entries);
const favoritesPlaylist = computed(
    () =>
        props.playlists.find((item) => item.id === FAVORITES_PLAYLIST_ID) ?? null,
);
const playlistCollections = computed(() =>
    props.playlists.filter((item) => item.id !== FAVORITES_PLAYLIST_ID),
);
const isInPlaylist = computed(() => !!props.activePlaylistId);
const isFavoritesActive = computed(
    () => props.activePlaylistId === FAVORITES_PLAYLIST_ID,
);
const hasPlaylistCollectionId = (
    playlistId: string | null,
): playlistId is string =>
    !!playlistId &&
    playlistCollections.value.some((item) => item.id === playlistId);

const loopModeLabel: Record<PlaylistLoopMode, string> = {
    list: "List Loop",
    shuffle: "Shuffle",
};

const sortModeLabel: Record<PlaylistSortMode, string> = {
    name: "Sort by Name",
    added: "Sort by Added Time",
};

const loopButtonLabel = computed(() =>
    props.isLoopOne ? "Single Loop" : loopModeLabel[props.loopMode],
);

const addButtonLabel = computed(() =>
    isInPlaylist.value ? "Add to current playlist" : "Create playlist",
);

const titleLabel = computed(() =>
    isInPlaylist.value ? "Playlist" : "Playlists",
);

const metaLabel = computed(() =>
    isInPlaylist.value
        ? `${playlistItems.value.length} items`
        : `${playlistCollections.value.length} playlists`,
);

const clampRatio = (value: number | undefined) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(Math.max(value ?? 0, 0), 1);
};

const getItemStyle = (entry: PlaylistDrawerEntry) => ({
    "--played-ratio": `${(clampRatio(entry.playedRatio) * 100).toFixed(2)}%`,
});

const clampWidth = (value: number) => {
    const maxWidth = Math.floor(window.innerWidth * 0.86);
    return Math.min(Math.max(value, MIN_DRAWER_WIDTH), maxWidth);
};

const normalizeWidthRatio = (value: unknown): number | null => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (value <= 0) return null;
    const normalized = Math.min(value, 0.86);
    return Math.round(normalized * 10000) / 10000;
};

const getDrawerWidthRatio = (width: number) => {
    if (typeof window === "undefined" || !Number.isFinite(window.innerWidth)) {
        return null;
    }
    const viewportWidth = window.innerWidth;
    if (viewportWidth <= 0) return null;
    return normalizeWidthRatio(width / viewportWidth);
};

const emitDrawerWidthRatio = (width: number) => {
    const ratio = getDrawerWidthRatio(width);
    if (ratio === null) return;
    emit("width-ratio-change", ratio);
};

const stopResizing = () => {
    if (!isResizing) return;
    isResizing = false;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", stopResizing);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    emitDrawerWidthRatio(drawerWidth.value);
};

const handlePointerMove = (event: PointerEvent) => {
    if (!isResizing) return;
    const delta = resizeStartX - event.clientX;
    drawerWidth.value = clampWidth(resizeStartWidth + delta);
};

const startResizing = (event: PointerEvent) => {
    isResizing = true;
    resizeStartX = event.clientX;
    resizeStartWidth = drawerWidth.value;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
};

const applyDrawerWidthFromRatio = (ratio: number | null) => {
    const normalized = normalizeWidthRatio(ratio);
    if (normalized === null) {
        drawerWidth.value = clampWidth(drawerWidth.value);
        return;
    }
    drawerWidth.value = clampWidth(window.innerWidth * normalized);
};

const handleWindowResize = () => {
    if (isResizing) return;
    applyDrawerWidthFromRatio(props.widthRatio);
};

const getParentPathWithoutItemName = (path: string) => {
    const normalized = path.trim().replace(/[\\/]+$/, "");
    if (!normalized) return "";
    const separatorIndex = Math.max(
        normalized.lastIndexOf("/"),
        normalized.lastIndexOf("\\"),
    );
    if (separatorIndex < 0) return "";
    if (separatorIndex === 0) return normalized.slice(0, 1);
    return normalized.slice(0, separatorIndex);
};

const formatPathForDrawerDisplay = (path: string) =>
    getPlaybackDisplayPathWithHomePrefix(path);

const commitPlaylistName = (playlistId: string, target: HTMLInputElement | null) => {
    if (!target) return;
    const currentName =
        playlistCollections.value.find((item) => item.id === playlistId)?.name ??
        "Playlist";
    const nextName = target.value.trim();

    if (!nextName) {
        target.value = currentName;
        playlistNameDrafts.value = {
            ...playlistNameDrafts.value,
            [playlistId]: currentName,
        };
        return;
    }

    target.value = nextName;
    playlistNameDrafts.value = {
        ...playlistNameDrafts.value,
        [playlistId]: nextName,
    };
    if (nextName === currentName) return;
    emit("rename-playlist", playlistId, nextName);
};

const onPlaylistNameEnter = (playlistId: string, event: KeyboardEvent) => {
    skipPreventOnBlurPlaylistId.value = playlistId;
    editingPlaylistId.value = null;
    const target = event.target as HTMLInputElement | null;
    target?.blur();
};

const onPlaylistNameInput = (playlistId: string, event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    playlistNameDrafts.value = {
        ...playlistNameDrafts.value,
        [playlistId]: target.value,
    };
};

const onPlaylistNameFocus = (playlistId: string) => {
    openedMenuPlaylistId.value = null;
    editingPlaylistId.value = playlistId;
};

const onPlaylistNameBlur = (playlistId: string, event: FocusEvent) => {
    commitPlaylistName(playlistId, event.target as HTMLInputElement | null);
    if (editingPlaylistId.value === playlistId) {
        editingPlaylistId.value = null;
    }
    if (skipPreventOnBlurPlaylistId.value === playlistId) {
        skipPreventOnBlurPlaylistId.value = null;
        return;
    }
    preventNextActivatePlaylistId.value = playlistId;
};

const focusPlaylistNameInput = (playlistId: string) => {
    void nextTick(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>(
            ".playlist-drawer__playlist-name-input[data-playlist-id]",
        );
        const input = [...inputs].find(
            (candidate) => candidate.dataset.playlistId === playlistId,
        );
        if (!input) return;
        input.focus();
        input.select();
    });
};

const startEditingPlaylistName = (playlistId: string) => {
    const targetPlaylist =
        playlistCollections.value.find((item) => item.id === playlistId) ?? null;
    const currentName = targetPlaylist?.name ?? "Playlist";
    const isFirstEdit = !hasInitializedEditDraftById.value[playlistId];
    const firstEntryPath = targetPlaylist?.entries[0]?.path ?? "";
    const firstEditDraft =
        formatPathForDrawerDisplay(getParentPathWithoutItemName(firstEntryPath)) ||
        currentName;
    const nextDraft = isFirstEdit
        ? firstEditDraft
        : playlistNameDrafts.value[playlistId] ?? currentName;
    playlistNameDrafts.value = {
        ...playlistNameDrafts.value,
        [playlistId]: nextDraft,
    };
    if (isFirstEdit) {
        hasInitializedEditDraftById.value = {
            ...hasInitializedEditDraftById.value,
            [playlistId]: true,
        };
    };
    preventNextActivatePlaylistId.value = playlistId;
    openedMenuPlaylistId.value = null;
    editingPlaylistId.value = playlistId;
    focusPlaylistNameInput(playlistId);
};

const togglePlaylistMenu = (playlistId: string) => {
    openedMenuPlaylistId.value =
        openedMenuPlaylistId.value === playlistId ? null : playlistId;
};

const removePlaylist = (playlistId: string) => {
    openedMenuPlaylistId.value = null;
    if (editingPlaylistId.value === playlistId) {
        editingPlaylistId.value = null;
    }
    emit("delete-playlist", playlistId);
};

const isEventFromPlaylistControl = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return !!target.closest(
        ".playlist-drawer__playlist-name-input, .playlist-drawer__playlist-actions",
    );
};

const onPlaylistCardActivate = (playlistId: string, event: Event) => {
    if (preventNextActivatePlaylistId.value === playlistId) {
        preventNextActivatePlaylistId.value = null;
        event.preventDefault();
        return;
    }
    if (editingPlaylistId.value === playlistId) return;
    if (isEventFromPlaylistControl(event)) return;
    openedMenuPlaylistId.value = null;
    emit("enter-playlist", playlistId);
};

const enterFavoritesPlaylist = () => {
    if (!favoritesPlaylist.value) return;
    openedMenuPlaylistId.value = null;
    emit("enter-playlist", FAVORITES_PLAYLIST_ID);
};

const cleanupPointerSorting = () => {
    window.removeEventListener("pointermove", onPlaylistPointerMove);
    window.removeEventListener("pointerup", onPlaylistPointerUp);
    window.removeEventListener("pointercancel", onPlaylistPointerUp);
    document.body.style.userSelect = "";
    if (
        activeDragSourceElement &&
        activeDragPointerId !== null &&
        activeDragSourceElement.hasPointerCapture?.(activeDragPointerId)
    ) {
        activeDragSourceElement.releasePointerCapture(activeDragPointerId);
    }
    activeDragSourceElement = null;
    activeDragPointerId = null;
    pendingPointerDragPlaylistId = null;
    isPointerSortingActive = false;
    draggingPlaylistId.value = null;
    dragOverPlaylistId.value = null;
    swapLockTargetPlaylistId.value = null;
};

const onPlaylistPointerMove = (event: PointerEvent) => {
    if (activeDragPointerId === null || event.pointerId !== activeDragPointerId) return;
    if (!pendingPointerDragPlaylistId) return;

    if (!isPointerSortingActive) {
        const movedX = Math.abs(event.clientX - pointerDragStartX);
        const movedY = Math.abs(event.clientY - pointerDragStartY);
        if (
            movedX < PLAYLIST_POINTER_DRAG_THRESHOLD_PX &&
            movedY < PLAYLIST_POINTER_DRAG_THRESHOLD_PX
        ) {
            return;
        }
        isPointerSortingActive = true;
        draggingPlaylistId.value = pendingPointerDragPlaylistId;
        dragOverPlaylistId.value = pendingPointerDragPlaylistId;
        swapLockTargetPlaylistId.value = null;
        preventNextActivatePlaylistId.value = pendingPointerDragPlaylistId;
        openedMenuPlaylistId.value = null;
        document.body.style.userSelect = "none";
    }

    const target = document.elementFromPoint(event.clientX, event.clientY) as
        | HTMLElement
        | null;
    const card = target?.closest<HTMLElement>(
        ".playlist-drawer__playlist[data-playlist-id]",
    );
    const targetPlaylistId = card?.dataset.playlistId ?? null;
    if (!hasPlaylistCollectionId(targetPlaylistId) || !card) {
        dragOverPlaylistId.value = null;
        swapLockTargetPlaylistId.value = null;
        return;
    }
    if (!draggingPlaylistId.value || targetPlaylistId === draggingPlaylistId.value) {
        dragOverPlaylistId.value = targetPlaylistId;
        return;
    }

    if (
        swapLockTargetPlaylistId.value &&
        targetPlaylistId !== swapLockTargetPlaylistId.value
    ) {
        swapLockTargetPlaylistId.value = null;
    }
    dragOverPlaylistId.value = targetPlaylistId;
    if (swapLockTargetPlaylistId.value === targetPlaylistId) {
        return;
    }
    const draggingId = draggingPlaylistId.value;
    if (!draggingId) return;
    emit("move-playlist", draggingId, targetPlaylistId);
    swapLockTargetPlaylistId.value = targetPlaylistId;
};

const onPlaylistPointerUp = (event: PointerEvent) => {
    if (activeDragPointerId === null || event.pointerId !== activeDragPointerId) return;
    if (isPointerSortingActive) {
        preventNextActivatePlaylistId.value =
            draggingPlaylistId.value ?? pendingPointerDragPlaylistId;
    }
    cleanupPointerSorting();
};

const onPlaylistCardPointerDown = (playlistId: string, event: PointerEvent) => {
    if (event.button !== 0) return;
    if (editingPlaylistId.value === playlistId) return;
    if (isEventFromPlaylistControl(event)) return;

    cleanupPointerSorting();
    activeDragPointerId = event.pointerId;
    activeDragSourceElement = event.currentTarget as HTMLElement | null;
    activeDragSourceElement?.setPointerCapture?.(event.pointerId);
    pointerDragStartX = event.clientX;
    pointerDragStartY = event.clientY;
    pendingPointerDragPlaylistId = playlistId;
    window.addEventListener("pointermove", onPlaylistPointerMove);
    window.addEventListener("pointerup", onPlaylistPointerUp);
    window.addEventListener("pointercancel", onPlaylistPointerUp);
};

const closeMenuByOutsidePointer = (event: PointerEvent) => {
    if (!openedMenuPlaylistId.value) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".playlist-drawer__playlist-actions")) return;
    openedMenuPlaylistId.value = null;
};

const normalizeScrollTop = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value);
};

const getSavedScrollTop = (playlistId: string | null) => {
    if (!playlistId) return normalizeScrollTop(props.scrollState.list);
    return normalizeScrollTop(props.scrollState.playlists[playlistId] ?? 0);
};

const emitScrollPosition = (playlistId: string | null, scrollTop: number) => {
    emit("scroll-position-change", playlistId, normalizeScrollTop(scrollTop));
};

const flushScrollPosition = (playlistId: string | null = props.activePlaylistId) => {
    if (scrollSyncTimer) {
        window.clearTimeout(scrollSyncTimer);
        scrollSyncTimer = null;
    }
    const container = contentRef.value;
    if (!container) return;
    emitScrollPosition(playlistId, container.scrollTop);
};

const restoreScrollPosition = async (playlistId: string | null) => {
    if (!props.open) return;
    await nextTick();
    const container = contentRef.value;
    if (!container) return;
    isRestoringScroll = true;
    container.scrollTop = getSavedScrollTop(playlistId);
    window.setTimeout(() => {
        isRestoringScroll = false;
    }, 0);
};

const onContentScroll = () => {
    if (isRestoringScroll) return;
    if (scrollSyncTimer) {
        window.clearTimeout(scrollSyncTimer);
    }
    scrollSyncTimer = window.setTimeout(() => {
        scrollSyncTimer = null;
        flushScrollPosition();
    }, 120);
};

watch(
    playlistCollections,
    (items) => {
        const nextDrafts: Record<string, string> = {};
        const nextInitialized: Record<string, boolean> = {};
        items.forEach((item) => {
            if (editingPlaylistId.value === item.id) {
                nextDrafts[item.id] = playlistNameDrafts.value[item.id] ?? item.name;
            } else {
                nextDrafts[item.id] = item.name;
            }
            if (hasInitializedEditDraftById.value[item.id]) {
                nextInitialized[item.id] = true;
            }
        });
        playlistNameDrafts.value = nextDrafts;
        hasInitializedEditDraftById.value = nextInitialized;
    },
    { immediate: true, deep: true },
);

watch(
    () => props.open,
    (isOpen, wasOpen) => {
        if (!isOpen) {
            if (wasOpen) {
                flushScrollPosition();
            }
            return;
        }
        void restoreScrollPosition(props.activePlaylistId);
    },
);

watch(
    () => props.activePlaylistId,
    (nextPlaylistId, previousPlaylistId) => {
        if (!props.open) return;
        if (nextPlaylistId === previousPlaylistId) return;
        flushScrollPosition(previousPlaylistId ?? null);
        void restoreScrollPosition(nextPlaylistId);
    },
);

watch(
    () => props.isReady,
    (isReady) => {
        if (!isReady || !props.open) return;
        void restoreScrollPosition(props.activePlaylistId);
    },
);

watch(
    () => props.widthRatio,
    (ratio) => {
        if (isResizing) return;
        applyDrawerWidthFromRatio(ratio);
    },
    { immediate: true },
);

onUnmounted(() => {
    flushScrollPosition();
    stopResizing();
    window.removeEventListener("resize", handleWindowResize);
    window.removeEventListener("pointerdown", closeMenuByOutsidePointer);
    cleanupPointerSorting();
});

onMounted(() => {
    window.addEventListener("resize", handleWindowResize);
    if (props.widthRatio === null) {
        emitDrawerWidthRatio(drawerWidth.value);
    }
});

watch(
    openedMenuPlaylistId,
    (playlistId) => {
        if (playlistId) {
            window.addEventListener("pointerdown", closeMenuByOutsidePointer);
            return;
        }
        window.removeEventListener("pointerdown", closeMenuByOutsidePointer);
    },
);
</script>

<template>
    <transition name="playlist-fade">
        <div
            v-if="props.open"
            class="playlist-drawer__backdrop"
            @click="emit('close')"
        ></div>
    </transition>

    <transition name="playlist-slide">
        <aside
            v-if="props.open"
            class="playlist-drawer ui-surface"
            :style="{ width: drawerWidth + 'px', maxWidth: '86vw' }"
        >
            <div
                class="playlist-drawer__resize"
                @pointerdown.prevent="startResizing"
            >
                <span class="playlist-drawer__resize-grip"></span>
            </div>
            <header class="playlist-drawer__header">
                <div class="playlist-drawer__header-main">
                    <button
                        v-if="isInPlaylist"
                        class="playlist-drawer__back"
                        type="button"
                        aria-label="Back to playlists"
                        title="Back"
                        @click="emit('back')"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            height="24px"
                            viewBox="0 -960 960 960"
                            width="24px"
                            fill="#e3e3e3"
                        >
                            <path
                                d="m313-440 224 224-57 56-320-320 320-320 57 56-224 224h487v80H313Z"
                            />
                        </svg>
                    </button>
                    <div>
                        <div v-if="!isInPlaylist" class="playlist-drawer__title">
                            {{ titleLabel }}
                        </div>
                        <div
                            v-else
                            class="playlist-drawer__active-name"
                            :class="{
                                'playlist-drawer__active-name--favorites':
                                    isFavoritesActive,
                            }"
                        >
                            <svg
                                v-if="isFavoritesActive"
                                class="playlist-drawer__active-name-icon"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                aria-hidden="true"
                            >
                                <path
                                    d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z"
                                />
                            </svg>
                            {{ props.activePlaylistName || titleLabel }}
                        </div>
                        <div class="playlist-drawer__meta">
                            {{ metaLabel }}
                        </div>
                    </div>
                </div>
                <div class="playlist-drawer__actions">
                    <button
                        v-if="!isInPlaylist"
                        class="playlist-drawer__tool playlist-drawer__tool--favorites"
                        type="button"
                        aria-label="Favorites"
                        title="Favorites"
                        @click="enterFavoritesPlaylist"
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path
                                d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z"
                            />
                        </svg>
                    </button>
                    <button
                        class="playlist-drawer__tool playlist-drawer__tool--add"
                        type="button"
                        :aria-label="addButtonLabel"
                        :title="addButtonLabel"
                        @click="emit('add')"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path
                                d="M12 5v14M5 12h14"
                                stroke-width="2"
                                stroke-linecap="round"
                            />
                        </svg>
                    </button>
                    <template v-if="isInPlaylist">
                        <button
                            class="playlist-drawer__tool playlist-drawer__tool--loop"
                            type="button"
                            :title="loopButtonLabel"
                            :aria-label="loopButtonLabel"
                            @click="emit('toggle-loop')"
                        >
                            <svg
                                v-if="props.isLoopOne"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path
                                    d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-2v6h2z"
                                />
                            </svg>
                            <svg
                                v-else-if="props.loopMode === 'list'"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path
                                    d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"
                                />
                            </svg>
                            <svg v-else viewBox="0 0 24 24" fill="currentColor">
                                <path
                                    d="M16 3h5v5h-2V6.41l-4.29 4.3-1.42-1.42L17.59 5H16V3zM4 3h5v2H6.41l4.3 4.29-1.42 1.42L5 6.41V8H3V3zm0 18v-5h2v2.59l4.29-4.3 1.42 1.42L6.41 19H9v2H4zm16-5h2v5h-5v-2h2.59l-4.3-4.29 1.42-1.42L19 17.59V16z"
                                />
                            </svg>
                        </button>
                        <button
                            class="playlist-drawer__tool playlist-drawer__tool--sort"
                            type="button"
                            :title="sortModeLabel[props.sortMode]"
                            :aria-label="sortModeLabel[props.sortMode]"
                            @click="emit('toggle-sort')"
                        >
                            <svg
                                v-if="props.sortMode === 'name'"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path
                                    d="M4 6h10v2H4V6zm0 5h8v2H4v-2zm0 5h6v2H4v-2zm11-9h2v10h-2V7zm0-2 3 3h-2.5V6h-1V8H12l3-3z"
                                />
                            </svg>
                            <svg v-else viewBox="0 0 24 24" fill="currentColor">
                                <path
                                    d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0-2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-.5 3h1v4l3 1-.4.9L11.5 13V8z"
                                />
                            </svg>
                        </button>
                        <button
                            class="playlist-drawer__tool playlist-drawer__tool--clear"
                            type="button"
                            aria-label="Clear playlist"
                            title="Clear"
                            @click="emit('clear')"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                height="24px"
                                viewBox="0 -960 960 960"
                                width="24px"
                                fill="#e3e3e3"
                            >
                                <path
                                    d="m576-80-56-56 104-104-104-104 56-56 104 104 104-104 56 56-104 104 104 104-56 56-104-104L576-80ZM120-320v-80h280v80H120Zm0-160v-80h440v80H120Zm0-160v-80h440v80H120Z"
                                />
                            </svg>
                        </button>
                    </template>
                </div>
            </header>

            <div
                ref="contentRef"
                class="playlist-drawer__content"
                @scroll.passive="onContentScroll"
            >
                <div v-if="!props.isReady" class="playlist-drawer__skeleton">
                    <div class="playlist-drawer__skeleton-row"></div>
                    <div class="playlist-drawer__skeleton-row"></div>
                    <div class="playlist-drawer__skeleton-row"></div>
                </div>
                <template v-else-if="!isInPlaylist">
                    <div
                        v-if="!playlistCollections.length"
                        class="playlist-drawer__empty"
                    >
                        <div class="playlist-drawer__empty-title">
                            No playlists yet
                        </div>
                        <div class="playlist-drawer__empty-body">
                            Click add to create your first playlist.
                        </div>
                    </div>
                    <transition-group
                        v-else
                        name="playlist-reorder"
                        tag="div"
                        class="playlist-drawer__list"
                    >
                        <div
                            v-for="item in playlistCollections"
                            :key="item.id"
                            class="playlist-drawer__playlist"
                            :class="{
                                'playlist-drawer__playlist--dragging':
                                    draggingPlaylistId === item.id,
                                'playlist-drawer__playlist--drag-over':
                                    dragOverPlaylistId === item.id &&
                                    draggingPlaylistId !== item.id,
                            }"
                            role="button"
                            tabindex="0"
                            :data-playlist-id="item.id"
                            @click="onPlaylistCardActivate(item.id, $event)"
                            @keydown.enter="onPlaylistCardActivate(item.id, $event)"
                            @keydown.space.prevent="
                                onPlaylistCardActivate(item.id, $event)
                            "
                            @pointerdown="onPlaylistCardPointerDown(item.id, $event)"
                        >
                            <div class="playlist-drawer__playlist-top">
                                <input
                                    v-if="editingPlaylistId === item.id"
                                    class="playlist-drawer__playlist-name-input"
                                    type="text"
                                    :value="playlistNameDrafts[item.id] ?? item.name"
                                    aria-label="Playlist name"
                                    :data-playlist-id="item.id"
                                    @keydown.stop
                                    @keydown.enter.prevent.stop="
                                        onPlaylistNameEnter(item.id, $event)
                                    "
                                    @input="onPlaylistNameInput(item.id, $event)"
                                    @focus="onPlaylistNameFocus(item.id)"
                                    @blur="onPlaylistNameBlur(item.id, $event)"
                                />
                                <span v-else class="playlist-drawer__playlist-name">
                                    {{ formatPathForDrawerDisplay(item.name) }}
                                </span>
                                <div class="playlist-drawer__playlist-actions">
                                    <button
                                        class="playlist-drawer__playlist-more"
                                        type="button"
                                        draggable="false"
                                        aria-label="Playlist menu"
                                        title="Playlist menu"
                                        @pointerdown.stop
                                        @click.stop="togglePlaylistMenu(item.id)"
                                    >
                                        <svg viewBox="0 0 24 24" fill="currentColor">
                                            <circle cx="12" cy="6" r="1.8" />
                                            <circle cx="12" cy="12" r="1.8" />
                                            <circle cx="12" cy="18" r="1.8" />
                                        </svg>
                                    </button>
                                    <div
                                        v-if="openedMenuPlaylistId === item.id"
                                        class="playlist-drawer__playlist-menu"
                                        @click.stop
                                    >
                                        <button
                                            class="playlist-drawer__playlist-menu-item"
                                            type="button"
                                            @click.stop="
                                                startEditingPlaylistName(item.id)
                                            "
                                        >
                                            Edit Playlist Name
                                        </button>
                                        <button
                                            class="playlist-drawer__playlist-menu-item playlist-drawer__playlist-menu-item--danger"
                                            type="button"
                                            @click.stop="removePlaylist(item.id)"
                                        >
                                            Delete Playlist
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="playlist-drawer__playlist-meta">
                                {{ item.entries.length }} items
                            </div>
                        </div>
                    </transition-group>
                </template>
                <template v-else>
                    <div
                        v-if="!playlistItems.length"
                        class="playlist-drawer__empty"
                    >
                        <div class="playlist-drawer__empty-title">
                            No items yet
                        </div>
                        <div class="playlist-drawer__empty-body">
                            Add files to this playlist.
                        </div>
                    </div>
                    <div v-else class="playlist-drawer__list">
                        <div
                            v-for="entry in playlistItems"
                            :key="entry.path"
                            class="playlist-drawer__item"
                            :class="{
                                'playlist-drawer__item--active':
                                    entry.path === props.currentUrl,
                            }"
                            :style="getItemStyle(entry)"
                            role="button"
                            tabindex="0"
                            @click="emit('play', entry)"
                            @keydown.enter="emit('play', entry)"
                            @keydown.space.prevent="emit('play', entry)"
                        >
                            <div class="playlist-drawer__item-title">
                                {{
                                    entry.title?.trim() ||
                                    getPathDisplayName(entry.path, "Untitled")
                                }}
                            </div>
                            <div class="playlist-drawer__item-sub">
                                {{ formatPathForDrawerDisplay(entry.path) }}
                            </div>
                            <button
                                class="playlist-drawer__remove"
                                type="button"
                                aria-label="Remove from playlist"
                                @click.stop="emit('remove', entry)"
                            >
                                <svg
                                    class="playlist-drawer__remove-icon"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                >
                                    <path d="M6 6l12 12M18 6l-12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </template>
            </div>
        </aside>
    </transition>
</template>
<style scoped>
.playlist-drawer__backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.15);
    z-index: 124;
}

.playlist-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(360px, 86vw);
    color: var(--text-color);
    border-left: 1px solid var(--glass-border);
    box-shadow:
        -12px 0 28px rgba(0, 0, 0, 0.2),
        inset 1px 0 0 var(--glass-highlight);
    border-radius: 14px 0 0 14px;
    z-index: 130;
    display: flex;
    flex-direction: column;
}

.playlist-drawer__resize {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 10px;
    cursor: ew-resize;
    display: flex;
    align-items: center;
    justify-content: center;
}

.playlist-drawer__resize-grip {
    width: 3px;
    height: 60px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.2);
}

.playlist-drawer__header {
    padding: 16px 16px 10px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.playlist-drawer__header-main {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

.playlist-drawer__back {
    border: none;
    background: rgba(255, 255, 255, 0.7);
    color: inherit;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    cursor: pointer;
    display: grid;
    place-items: center;
    flex-shrink: 0;
}

.playlist-drawer__back svg {
    width: 20px;
    height: 20px;
}

.playlist-drawer__actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.playlist-drawer__tool {
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: rgba(255, 255, 255, 0.7);
    color: inherit;
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 999px;
    cursor: pointer;
    transition:
        transform 0.15s ease,
        box-shadow 0.15s ease,
        border-color 0.15s ease;
}

.playlist-drawer__tool:hover,
.playlist-drawer__back:hover {
    transform: translateY(-1px);
    border-color: rgba(0, 0, 0, 0.2);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}

.playlist-drawer__tool:focus-visible,
.playlist-drawer__back:focus-visible {
    outline: 2px solid rgba(57, 108, 216, 0.6);
    outline-offset: 2px;
}

.playlist-drawer__tool svg {
    width: 18px;
    height: 18px;
}

.playlist-drawer__tool--favorites {
    color: rgba(213, 46, 89, 0.95);
}

.playlist-drawer__title {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.02em;
}

.playlist-drawer__active-name {
    margin-top: 2px;
    font-size: 12px;
    font-weight: 600;
    opacity: 0.85;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.playlist-drawer__active-name--favorites {
    display: flex;
    align-items: center;
    gap: 7px;
    opacity: 1;
}

.playlist-drawer__active-name-icon {
    width: 15px;
    height: 15px;
    color: rgba(213, 46, 89, 0.95);
    flex-shrink: 0;
}

.playlist-drawer__meta {
    margin-top: 4px;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.6);
}

.playlist-drawer__close {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    color: inherit;
}

.playlist-drawer__close:hover {
    background: rgba(0, 0, 0, 0.08);
}

.playlist-drawer__content {
    padding: 6px 12px 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
}

.playlist-drawer__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.playlist-drawer__playlist {
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 12px;
    padding: 10px 12px;
    padding-right: 44px;
    background: rgba(255, 255, 255, 0.7);
    color: inherit;
    cursor: pointer;
    position: relative;
    user-select: none;
    -webkit-user-select: none;
    transition:
        transform 0.15s ease,
        box-shadow 0.15s ease,
        border-color 0.15s ease;
}

.playlist-drawer__playlist:hover {
    border-color: rgba(0, 0, 0, 0.2);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}

.playlist-drawer__playlist--dragging {
    opacity: 0.46;
    transform: none;
    box-shadow: none;
}

.playlist-drawer__playlist--drag-over {
    border-color: rgba(57, 108, 216, 0.65);
    box-shadow: 0 0 0 1px rgba(57, 108, 216, 0.25);
}

.playlist-reorder-move {
    transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.playlist-drawer__playlist:focus-visible {
    outline: 2px solid rgba(57, 108, 216, 0.6);
    outline-offset: 2px;
}

.playlist-drawer__playlist-top {
    display: flex;
    align-items: center;
    gap: 10px;
}

.playlist-drawer__playlist-name-input {
    border: none;
    background: transparent;
    color: inherit;
    font-size: 13px;
    font-weight: 600;
    min-width: 0;
    flex: 1;
    padding: 0;
}

.playlist-drawer__playlist-name {
    min-width: 0;
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.playlist-drawer__playlist-name-input:focus-visible {
    outline: 2px solid rgba(57, 108, 216, 0.5);
    outline-offset: 2px;
    border-radius: 4px;
}

.playlist-drawer__playlist-actions {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 3;
}

.playlist-drawer__playlist-more {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    border-radius: 8px;
    color: inherit;
    cursor: pointer;
    display: grid;
    place-items: center;
}

.playlist-drawer__playlist-more:hover {
    background: rgba(0, 0, 0, 0.08);
}

.playlist-drawer__playlist-more:focus-visible {
    outline: 2px solid rgba(57, 108, 216, 0.6);
    outline-offset: 1px;
}

.playlist-drawer__playlist-more svg {
    width: 18px;
    height: 18px;
}

.playlist-drawer__playlist-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 170px;
    border-radius: 10px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: rgba(255, 255, 255, 0.98);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
    padding: 4px;
    z-index: 8;
}

.playlist-drawer__playlist-menu-item {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    border-radius: 7px;
    text-align: left;
    font-size: 12px;
    font-weight: 600;
    padding: 8px 10px;
    cursor: pointer;
}

.playlist-drawer__playlist-menu-item:hover {
    background: rgba(0, 0, 0, 0.08);
}

.playlist-drawer__playlist-menu-item--danger {
    color: rgba(168, 35, 35, 0.95);
}

.playlist-drawer__playlist-meta {
    margin-top: 4px;
    font-size: 11px;
    color: rgba(0, 0, 0, 0.55);
}

.playlist-drawer__item {
    --played-ratio: 0%;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 12px;
    padding: 10px 12px;
    padding-right: 42px;
    text-align: left;
    background: rgba(255, 255, 255, 0.7);
    color: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    position: relative;
    overflow: hidden;
    transition:
        transform 0.15s ease,
        box-shadow 0.15s ease,
        border-color 0.15s ease;
}

.playlist-drawer__item::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--played-ratio);
    border-radius: inherit;
    pointer-events: none;
    background: linear-gradient(
        90deg,
        rgba(57, 108, 216, 0.2),
        rgba(57, 108, 216, 0.08)
    );
    z-index: 0;
}

.playlist-drawer__item:hover {
    transform: translateY(-1px);
    border-color: rgba(0, 0, 0, 0.2);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}

.playlist-drawer__item--active {
    border-color: rgba(57, 108, 216, 0.6);
    box-shadow: 0 0 0 1px rgba(57, 108, 216, 0.2);
}

.playlist-drawer__item:focus-visible {
    outline: 2px solid rgba(57, 108, 216, 0.6);
    outline-offset: 2px;
}

.playlist-drawer__item-title,
.playlist-drawer__item-sub,
.playlist-drawer__remove {
    position: relative;
    z-index: 1;
}

.playlist-drawer__remove {
    position: absolute;
    right: 6px;
    top: 50%;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: inherit;
    padding: 0;
    border-radius: 8px;
    cursor: pointer;
    display: grid;
    place-items: center;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-50%);
    transition:
        color 0.2s ease,
        background-color 0.2s ease,
        transform 0.2s ease,
        opacity 0.3s ease;
}

.playlist-drawer__item:hover .playlist-drawer__remove,
.playlist-drawer__remove:focus-visible {
    opacity: 1;
    pointer-events: auto;
}

.playlist-drawer__remove:focus-visible {
    transform: translateY(-50%);
    outline: 2px solid rgba(57, 108, 216, 0.5);
    outline-offset: 1px;
}

.playlist-drawer__remove-icon {
    width: 20px;
    height: 20px;
    fill: currentColor;
}

.playlist-drawer__remove:hover {
    background: rgba(0, 0, 0, 0.06);
    color: rgba(168, 35, 35, 0.95);
    transform: translateY(calc(-50% - 1px));
}

.playlist-drawer__item-title {
    font-size: 13px;
    font-weight: 600;
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.playlist-drawer__item-sub {
    font-size: 11px;
    color: rgba(0, 0, 0, 0.55);
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.playlist-drawer__empty {
    padding: 24px 12px;
    text-align: center;
}

.playlist-drawer__empty-title {
    font-size: 14px;
    font-weight: 600;
}

.playlist-drawer__empty-body {
    margin-top: 6px;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.6);
}

.playlist-drawer__skeleton-row {
    height: 56px;
    border-radius: 12px;
    background: linear-gradient(
        90deg,
        rgba(0, 0, 0, 0.05) 25%,
        rgba(0, 0, 0, 0.1) 37%,
        rgba(0, 0, 0, 0.05) 63%
    );
    background-size: 400% 100%;
    animation: playlist-skeleton 1.4s ease infinite;
}

@keyframes playlist-skeleton {
    0% {
        background-position: 100% 0;
    }
    100% {
        background-position: 0 0;
    }
}

.playlist-slide-enter-active,
.playlist-slide-leave-active {
    transition: transform 0.25s ease;
}

.playlist-slide-enter-from,
.playlist-slide-leave-to {
    transform: translateX(100%);
}

.playlist-fade-enter-active,
.playlist-fade-leave-active {
    transition: opacity 0.2s ease;
}

.playlist-fade-enter-from,
.playlist-fade-leave-to {
    opacity: 0;
}

@media (prefers-color-scheme: dark) {
    :root:not([data-theme]) .playlist-drawer {
        border-left-color: rgba(255, 255, 255, 0.12);
        box-shadow:
            -12px 0 28px rgba(0, 0, 0, 0.45),
            inset 1px 0 0 var(--glass-highlight);
    }

    :root:not([data-theme]) .playlist-drawer__meta,
    :root:not([data-theme]) .playlist-drawer__playlist-meta,
    :root:not([data-theme]) .playlist-drawer__item-sub,
    :root:not([data-theme]) .playlist-drawer__empty-body {
        color: rgba(255, 255, 255, 0.65);
    }

    :root:not([data-theme]) .playlist-drawer__item,
    :root:not([data-theme]) .playlist-drawer__playlist {
        background: rgba(20, 20, 20, 0.65);
        border-color: rgba(255, 255, 255, 0.12);
    }

    :root:not([data-theme]) .playlist-drawer__item:hover,
    :root:not([data-theme]) .playlist-drawer__playlist:hover {
        border-color: rgba(255, 255, 255, 0.2);
    }

    :root:not([data-theme]) .playlist-drawer__item--active {
        border-color: rgba(57, 108, 216, 0.7);
        box-shadow: 0 0 0 1px rgba(57, 108, 216, 0.3);
    }

    :root:not([data-theme]) .playlist-drawer__close:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    :root:not([data-theme]) .playlist-drawer__tool,
    :root:not([data-theme]) .playlist-drawer__back {
        border-color: rgba(255, 255, 255, 0.18);
        background: rgba(26, 26, 26, 0.7);
    }

    :root:not([data-theme]) .playlist-drawer__tool:hover,
    :root:not([data-theme]) .playlist-drawer__back:hover {
        border-color: rgba(255, 255, 255, 0.3);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
    }

    :root:not([data-theme]) .playlist-drawer__playlist-more:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    :root:not([data-theme]) .playlist-drawer__playlist-menu {
        border-color: rgba(255, 255, 255, 0.2);
        background: rgba(26, 26, 26, 0.96);
    }

    :root:not([data-theme]) .playlist-drawer__playlist-menu-item:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    :root:not([data-theme]) .playlist-drawer__remove:hover {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 177, 177, 0.95);
        transform: translateY(calc(-50% - 1px));
    }

    :root:not([data-theme]) .playlist-drawer__resize-grip {
        background: rgba(255, 255, 255, 0.2);
    }

    :root:not([data-theme]) .playlist-drawer__skeleton-row {
        background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.06) 25%,
            rgba(255, 255, 255, 0.14) 37%,
            rgba(255, 255, 255, 0.06) 63%
        );
    }
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer {
    border-left-color: rgba(255, 255, 255, 0.12);
    box-shadow:
        -12px 0 28px rgba(0, 0, 0, 0.45),
        inset 1px 0 0 var(--glass-highlight);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__meta,
:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__playlist-meta,
:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__item-sub,
:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__empty-body {
    color: rgba(255, 255, 255, 0.65);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__item,
:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__playlist {
    background: rgba(20, 20, 20, 0.65);
    border-color: rgba(255, 255, 255, 0.12);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__item::before {
    background: linear-gradient(
        90deg,
        rgba(138, 183, 255, 0.28),
        rgba(138, 183, 255, 0.14)
    );
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__item:hover,
:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__playlist:hover {
    border-color: rgba(255, 255, 255, 0.2);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__item--active {
    border-color: rgba(57, 108, 216, 0.7);
    box-shadow: 0 0 0 1px rgba(57, 108, 216, 0.3);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__close:hover {
    background: rgba(255, 255, 255, 0.1);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__tool,
:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__back {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(26, 26, 26, 0.7);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__tool:hover,
:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__back:hover {
    border-color: rgba(255, 255, 255, 0.3);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__playlist-more:hover {
    background: rgba(255, 255, 255, 0.1);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__playlist-menu {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(26, 26, 26, 0.96);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__playlist-menu-item:hover {
    background: rgba(255, 255, 255, 0.1);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__remove:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 177, 177, 0.95);
    transform: translateY(calc(-50% - 1px));
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__resize-grip {
    background: rgba(255, 255, 255, 0.2);
}

:root:is([data-theme="dark"], [data-theme="graphite"]) .playlist-drawer__skeleton-row {
    background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0.06) 25%,
        rgba(255, 255, 255, 0.14) 37%,
        rgba(255, 255, 255, 0.06) 63%
    );
}

:root[data-theme="graphite"] .playlist-drawer__item,
:root[data-theme="graphite"] .playlist-drawer__playlist {
    background: rgba(52, 58, 66, 0.72);
    border-color: rgba(166, 176, 190, 0.22);
}

:root[data-theme="graphite"] .playlist-drawer__item:hover,
:root[data-theme="graphite"] .playlist-drawer__playlist:hover {
    background: rgba(60, 67, 76, 0.76);
    border-color: rgba(187, 196, 210, 0.28);
}

:root[data-theme="graphite"] .playlist-drawer__item--active {
    background: rgba(64, 72, 82, 0.82);
    border-color: rgba(130, 159, 196, 0.62);
    box-shadow: 0 0 0 1px rgba(130, 159, 196, 0.26);
}
</style>
