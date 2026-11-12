<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useCasting } from "../composables/useCasting";
import { tauriCastingClient } from "../core-client/tauriCastingClient";
import type { CastDeviceDto } from "../core-client/generated/CastDeviceDto";

const props = defineProps<{
    isFileLoaded: boolean;
}>();
const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();

const isOpen = ref(false);
const casting = useCasting(tauriCastingClient);
const hasError = computed(() => Boolean(casting.error.value || casting.snapshot.value.lastError));
const errorMessage = computed(
    () => casting.error.value || casting.snapshot.value.lastError?.message || "",
);
const activeCapabilityHint = computed(() => {
    const capabilities = casting.snapshot.value.device?.capabilities;
    if (!capabilities) return "";
    const unavailable: string[] = [];
    if (!capabilities.play || !capabilities.pause) unavailable.push("play/pause");
    if (!capabilities.seek) unavailable.push("seeking");
    if (!capabilities.volume) unavailable.push("volume");
    const receiverControls = unavailable.length
        ? `Unavailable on this receiver: ${unavailable.join(", ")}.`
        : "";
    return `${receiverControls}${receiverControls ? " " : ""}Speed, track selection, video effects and PiP are unavailable while casting.`;
});
const phaseLabel = computed(() => {
    const labels: Record<string, string> = {
        connecting: "Connecting",
        loading: "Loading media",
        playing: "Casting",
        paused: "Paused",
        buffering: "Buffering",
        stopped: "Stopped",
        disconnected: "Disconnected",
        error: "Needs attention",
    };
    return labels[casting.snapshot.value.phase] ?? "";
});

const openAndDiscover = () => {
    isOpen.value = !isOpen.value;
    emit("update:open", isOpen.value);
    if (isOpen.value) {
        void casting.discover(false);
    }
};

const deviceCapabilityHint = (device: CastDeviceDto) => {
    const unavailable: string[] = [];
    if (!device.capabilities.play || !device.capabilities.pause) unavailable.push("playback");
    if (!device.capabilities.seek) unavailable.push("seek");
    if (!device.capabilities.volume) unavailable.push("volume");
    return unavailable.length ? `No ${unavailable.join(" or ")}` : "Playback controls ready";
};
const isCurrentDevice = (device: CastDeviceDto) => {
    const active = casting.snapshot.value.device;
    return Boolean(
        casting.isActive.value &&
        active &&
        active.id === device.id &&
        active.protocol === device.protocol,
    );
};

const closeOnOutsidePointer = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (!target || (target as Element).closest?.(".cast-popover")) return;
    if (!isOpen.value) return;
    isOpen.value = false;
    emit("update:open", false);
};

onMounted(() => {
    window.addEventListener("pointerdown", closeOnOutsidePointer);
});

onUnmounted(() => {
    window.removeEventListener("pointerdown", closeOnOutsidePointer);
});
</script>

<template>
    <div class="cast-popover" data-window-no-drag>
        <button
            class="icon-button top-bar__action cast-popover__trigger"
            :class="{ 'cast-popover__trigger--active': casting.isActive.value }"
            type="button"
            title="Cast"
            aria-label="Cast"
            :aria-expanded="isOpen"
            @click.stop="openAndDiscover"
        >
            <svg viewBox="0 -960 960 960" aria-hidden="true">
                <path v-if="!casting.isActive.value" d="M480-480Zm320 320H600q0-20-1.5-40t-4.5-40h206v-480H160v46q-20-3-40-4.5T80-680v-40q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160Zm-720 0v-120q50 0 85 35t35 85H80Zm200 0q0-83-58.5-141.5T80-360v-80q117 0 198.5 81.5T360-160h-80Zm160 0q0-75-28.5-140.5t-77-114q-48.5-48.5-114-77T80-520v-80q91 0 171 34.5T391-471q60 60 94.5 140T520-160h-80Z" />
                <path v-else d="M720-320H575q-7-21-15.5-41.5T542-400h98v-160H413q-29-25-62.5-45T281-640h439v320ZM480-480ZM80-160v-120q50 0 85 35t35 85H80Zm200 0q0-83-58.5-141.5T80-360v-80q117 0 198.5 81.5T360-160h-80Zm160 0q0-75-28.5-140.5t-77-114q-48.5-48.5-114-77T80-520v-80q91 0 171 34.5T391-471q60 60 94.5 140T520-160h-80Zm360 0H600q0-20-1.5-40t-4.5-40h206v-480H160v46q-20-3-40-4.5T80-680v-40q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160Z" />
            </svg>
        </button>

        <transition name="fade-up">
            <section
                v-if="isOpen"
                class="cast-popover__panel"
                role="dialog"
                aria-label="Cast devices"
                @pointerdown.stop
                @mousedown.stop
                @click.stop
            >
            <header class="cast-popover__header">
                <div>
                    <strong>Cast</strong>
                    <p v-if="casting.isActive.value" class="cast-popover__status">
                        <span class="cast-popover__status-dot" aria-hidden="true"></span>
                        {{ casting.activeDeviceName.value }} · {{ phaseLabel }}
                    </p>
                    <p v-else>Choose a receiver on your network</p>
                </div>
                <button
                    class="cast-popover__scan"
                    type="button"
                    :disabled="casting.isDiscovering.value"
                    @click="casting.discover"
                >
                    {{ casting.isDiscovering.value ? "Scanning…" : "Scan" }}
                </button>
            </header>

            <div v-if="hasError" class="cast-popover__error">
                {{ errorMessage }}
                <button type="button" @click="casting.discover">Retry</button>
            </div>

            <div v-if="casting.isActive.value" class="cast-popover__active">
                <div class="cast-popover__active-header">
                    <div class="cast-popover__active-copy">
                        <span class="cast-popover__eyebrow">Now casting</span>
                        <strong>{{ casting.snapshot.value.mediaTitle || "Current media" }}</strong>
                    </div>
                    <button type="button" @click="casting.disconnect">Stop Casting</button>
                </div>
                <span v-if="activeCapabilityHint" class="cast-popover__capability-hint">
                    {{ activeCapabilityHint }}
                </span>
            </div>

            <div v-if="casting.isDiscovering.value && !casting.devices.value.length" class="cast-popover__empty">
                Looking for receivers…
            </div>
            <div v-else-if="!casting.devices.value.length" class="cast-popover__empty">
                No receivers found. Check that the device is awake and on the same network.
            </div>
            <template v-else>
                <div class="cast-popover__section-label">Available receivers</div>
                <ul class="cast-popover__devices">
                <li v-for="device in casting.devices.value" :key="`${device.protocol}:${device.id}`">
                    <button
                        type="button"
                        :disabled="!props.isFileLoaded || casting.isConnecting.value"
                        @click="casting.connect(device.id)"
                    >
                        <span class="cast-popover__device-icon" :class="{ 'cast-popover__device-icon--active': isCurrentDevice(device) }" aria-hidden="true">
                            <svg v-if="!isCurrentDevice(device)" viewBox="0 -960 960 960"><path d="M320-120v-80H160q-33 0-56.5-23.5T80-280v-480q0-33 23.5-56.5T160-840h640q33 0 56.5 23.5T880-760v480q0 33-23.5 56.5T800-200H640v80H320ZM160-280h640v-480H160v480Zm0 0v-480 480Z" /></svg>
                            <svg v-else viewBox="0 -960 960 960"><path d="M200-320h80q0-33-23.5-56.5T200-400v80Zm142 0h58q0-83-58.5-141.5T200-520v58q59 0 100.5 41.5T342-320Zm120 0h58q0-66-25-124.5t-68.5-102Q383-590 324.5-615T200-640v58q109 0 185.5 76.5T462-320ZM320-120v-80H160q-33 0-56.5-23.5T80-280v-480q0-33 23.5-56.5T160-840h640q33 0 56.5 23.5T880-760v480q0 33-23.5 56.5T800-200H640v80H320ZM160-280h640v-480H160v480Zm0 0v-480 480Z" /></svg>
                        </span>
                        <span class="cast-popover__device-copy">
                            <span class="cast-popover__device-name">{{ device.name }}</span>
                            <span class="cast-popover__device-capabilities">{{ deviceCapabilityHint(device) }}</span>
                        </span>
                        <span class="cast-popover__device-meta">
                            <span class="cast-popover__device-protocol">{{ device.protocol === "dlna" ? "DLNA" : "Chromecast" }}</span>
                        </span>
                    </button>
                </li>
                </ul>
            </template>
            <p v-if="!props.isFileLoaded" class="cast-popover__hint">Open media before connecting.</p>
            </section>
        </transition>
    </div>
</template>

<style scoped>
.cast-popover { position: relative; z-index: 120; flex: none; }
.cast-popover__trigger { display: grid; width: var(--top-bar-action-size, 30px); height: var(--top-bar-action-size, 30px); place-items: center; border-radius: 8px; padding: var(--top-bar-action-padding, 4px); margin-top: var(--top-bar-action-margin-top, 0px); color: white; position: relative; transition: color .2s, transform .1s; }
.cast-popover__trigger:hover { color: #ccc; transform: scale(1.1); }
.cast-popover__trigger:active { transform: scale(.95); }
.cast-popover__trigger--active { color: #8fb3ff; }
.cast-popover__trigger svg { width: 100%; height: 100%; fill: currentColor; }
.cast-popover__panel { position: absolute; top: calc(var(--top-bar-action-size, 30px) + 5px); right: 0; width: min(380px, calc(100vw - 24px)); max-height: min(430px, calc(100vh - 90px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; color: rgba(255,255,255,.92); background: rgba(28,28,28,.78); box-shadow: 0 4px 12px rgba(0,0,0,.5); backdrop-filter: blur(10px); transform-origin: top right; }
.cast-popover__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,.1); background: rgba(28,28,28,.95); }
.cast-popover__header strong { font-size: 14px; font-weight: 700; }
.cast-popover__header p, .cast-popover__hint { margin: 3px 0 0; color: rgba(255,255,255,.6); font-size: 11px; }
.cast-popover__status { display: flex; align-items: center; gap: 5px; }
.cast-popover__status-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: #73d49b; box-shadow: 0 0 0 3px rgba(115,212,155,.14); }
.cast-popover__scan, .cast-popover__active button, .cast-popover__error button { border: 0; border-radius: 6px; padding: 5px 9px; color: inherit; background: rgba(255,255,255,.1); font: inherit; font-size: 11px; cursor: pointer; transition: background-color .2s, color .2s; }
.cast-popover__active button { flex: none; white-space: nowrap; }
.cast-popover__scan:hover:not(:disabled), .cast-popover__active button:hover, .cast-popover__error button:hover { background: rgba(255,255,255,.18); color: #fff; }
.cast-popover__scan:disabled { cursor: wait; opacity: .55; }
.cast-popover__section-label { padding: 11px 14px 5px; color: rgba(255,255,255,.45); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.cast-popover__devices { max-height: 280px; margin: 0; padding: 2px 6px 7px; overflow: auto; list-style: none; }
.cast-popover__devices button { display: flex; width: 100%; align-items: center; gap: 10px; border: 0; border-radius: 9px; padding: 10px; color: inherit; background: transparent; text-align: left; cursor: pointer; transition: background-color .2s, transform .15s; }
.cast-popover__devices button:hover:not(:disabled) { background: rgba(255,255,255,.12); }
.cast-popover__devices button:hover:not(:disabled) { transform: translateX(2px); }
.cast-popover__devices button:disabled { cursor: not-allowed; opacity: .45; }
.cast-popover__device-icon { display: grid; width: 32px; height: 32px; flex: none; place-items: center; border: 1px solid rgba(255,255,255,.2); border-radius: 9px; background: rgba(255,255,255,.08); color: rgba(255,255,255,.72); }
.cast-popover__device-icon--active { border-color: rgba(143,179,255,.65); background: rgba(143,179,255,.16); color: #a9c4ff; }
.cast-popover__device-icon svg { width: 18px; height: 18px; fill: currentColor; }
.cast-popover__device-copy { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 3px; }
.cast-popover__device-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 650; }
.cast-popover__device-meta { display: inline-flex; flex: none; align-items: center; }
.cast-popover__device-protocol { border: 1px solid rgba(255,255,255,.13); border-radius: 5px; padding: 2px 5px; background: rgba(255,255,255,.07); color: rgba(255,255,255,.72); font-size: 10px; line-height: 1.15; }
.cast-popover__device-capabilities { color: rgba(255,255,255,.46); font-size: 10px; }
.cast-popover__empty { padding: 28px 20px; color: rgba(255,255,255,.6); font-size: 12px; line-height: 1.45; text-align: center; }
.cast-popover__active, .cast-popover__error { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,.1); font-size: 12px; }
.cast-popover__active-header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; }
.cast-popover__error { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cast-popover__active-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cast-popover__eyebrow { color: rgba(255,255,255,.48); font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.cast-popover__active strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.cast-popover__error { color: #ffb4ae; background: rgba(190,58,48,.14); }
.cast-popover__error button { color: inherit; }
.cast-popover__hint { padding: 0 14px 11px; }
.cast-popover__capability-hint { flex: 0 0 100%; margin: 0; padding: 0; color: rgba(255,220,150,.78); font-size: 10px; line-height: 1.4; }

:global(:root[data-theme="light"]) .cast-popover__trigger { color: rgba(28,38,52,.9); }
:global(:root[data-theme="light"]) .cast-popover__trigger:hover { color: rgba(18,28,40,1); }
:global(:root[data-theme="light"]) .cast-popover__trigger--active { color: #2f65c9; }
:global(:root[data-theme="light"]) .cast-popover__panel { border-color: rgba(30,46,63,.14); color: #263545; background: rgba(250,252,255,.9); box-shadow: 0 4px 12px rgba(26,42,58,.18); }
:global(:root[data-theme="light"]) .cast-popover__header { border-color: rgba(30,46,63,.1); background: rgba(250,252,255,.96); }
:global(:root[data-theme="light"]) .cast-popover__active { border-color: rgba(30,46,63,.1); }
:global(:root[data-theme="light"]) .cast-popover__scan,
:global(:root[data-theme="light"]) .cast-popover__active button,
:global(:root[data-theme="light"]) .cast-popover__error button { background: rgba(30,46,63,.08); }
:global(:root[data-theme="light"]) .cast-popover__scan:hover:not(:disabled),
:global(:root[data-theme="light"]) .cast-popover__active button:hover,
:global(:root[data-theme="light"]) .cast-popover__error button:hover { background: rgba(30,46,63,.14); color: #263545; }
:global(:root[data-theme="light"]) .cast-popover__devices button:hover:not(:disabled) { background: rgba(30,46,63,.08); }
:global(:root[data-theme="light"]) .cast-popover__section-label { color: rgba(38,53,69,.48); }
:global(:root[data-theme="light"]) .cast-popover__device-icon { border-color: rgba(38,53,69,.2); background: rgba(38,53,69,.07); color: rgba(38,53,69,.7); }
:global(:root[data-theme="light"]) .cast-popover__device-icon--active { border-color: rgba(47,101,201,.45); background: rgba(47,101,201,.1); color: #2f65c9; }
:global(:root[data-theme="light"]) .cast-popover__eyebrow { color: rgba(38,53,69,.48); }
:global(:root[data-theme="light"]) .cast-popover__device-protocol { border-color: rgba(30,46,63,.13); background: rgba(30,46,63,.06); }
:global(:root[data-theme="light"]) .cast-popover__header p, :global(:root[data-theme="light"]) .cast-popover__hint, :global(:root[data-theme="light"]) .cast-popover__empty, :global(:root[data-theme="light"]) .cast-popover__device-protocol { color: rgba(38,53,69,.58); }
:global(:root[data-theme="light"]) .cast-popover__device-capabilities { color: rgba(38,53,69,.48); }
:global(:root[data-theme="light"]) .cast-popover__capability-hint { border-color: rgba(30,46,63,.1); color: rgba(139,92,20,.9); }
</style>
