import { computed, onBeforeUnmount, onMounted, readonly, ref } from "vue";
import type { CastingClient } from "../core-client/CastingClient";
import type { CastDeviceDto } from "../core-client/generated/CastDeviceDto";
import type { CastSnapshotDto } from "../core-client/generated/CastSnapshotDto";

const emptySnapshot = (): CastSnapshotDto => ({
    revision: 0,
    phase: "idle",
    sessionId: null,
    device: null,
    mediaTitle: null,
    position: 0,
    duration: 0,
    volume: 100,
    muted: false,
    seekable: false,
    lastError: null,
});

export const useCasting = (client: CastingClient) => {
    let store = castingStores.get(client);
    if (!store) {
        store = createCastingStore(client);
        castingStores.set(client, store);
    }

    onMounted(store.acquire);
    onBeforeUnmount(store.release);
    return store.api;
};

const castingStores = new WeakMap<CastingClient, ReturnType<typeof createCastingStore>>();

const createCastingStore = (client: CastingClient) => {
    const snapshot = ref<CastSnapshotDto>(emptySnapshot());
    const devices = ref<CastDeviceDto[]>([]);
    const isReady = ref(false);
    const isDiscovering = ref(false);
    const isBackgroundDiscovering = ref(false);
    let discoverPromise: Promise<void> | null = null;
    const isConnecting = ref(false);
    const error = ref("");
    let unsubscribe: (() => void) | null = null;
    let consumers = 0;
    let devicesRevision = 0;

    const isActive = computed(() => snapshot.value.sessionId !== null);
    const activeDeviceName = computed(() => snapshot.value.device?.name ?? "");
    const applySnapshot = (nextSnapshot: CastSnapshotDto) => {
        if (nextSnapshot.revision >= snapshot.value.revision) {
            snapshot.value = nextSnapshot;
        }
    };

    const refresh = async () => {
        const refreshDevicesRevision = devicesRevision;
        try {
            const [nextSnapshot, nextDevices] = await Promise.all([
                client.getSnapshot(),
                client.getDevices(),
            ]);
            applySnapshot(nextSnapshot);
            // Device events do not carry a revision. Do not let a slow initial refresh overwrite
            // a newer event-delivered device list.
            if (devicesRevision === refreshDevicesRevision) {
                devices.value = nextDevices;
            }
            error.value = "";
            isReady.value = true;
        } catch (cause) {
            error.value = toMessage(cause);
        }
    };

    const discover = (showProgress: boolean | Event = true) => {
        if (showProgress) isDiscovering.value = true;
        else isBackgroundDiscovering.value = true;
        if (!discoverPromise) {
            error.value = "";
            discoverPromise = client
                .discover()
                .then((nextDevices) => {
                    devices.value = nextDevices;
                    devicesRevision += 1;
                })
                .catch((cause) => {
                    error.value = toMessage(cause);
                })
                .finally(() => {
                    discoverPromise = null;
                });
        }
        return discoverPromise.finally(() => {
            if (showProgress) isDiscovering.value = false;
            else isBackgroundDiscovering.value = false;
        });
    };

    const connect = async (deviceId: string) => {
        isConnecting.value = true;
        error.value = "";
        try {
            applySnapshot(await client.connect(deviceId));
        } catch (cause) {
            error.value = toMessage(cause);
        } finally {
            isConnecting.value = false;
        }
    };

    const disconnect = async () => {
        try {
            applySnapshot(await client.disconnect());
            error.value = "";
        } catch (cause) {
            error.value = toMessage(cause);
        }
    };

    const acquire = () => {
        consumers += 1;
        if (unsubscribe) return;
        unsubscribe = client.subscribe(
            (nextSnapshot) => {
                applySnapshot(nextSnapshot);
            },
            (nextDevices) => {
                devices.value = nextDevices;
                devicesRevision += 1;
            },
            (cause) => {
                error.value = cause.message;
            },
        );
        void refresh();
        void discover(false);
    };

    const release = () => {
        consumers -= 1;
        if (consumers > 0) return;
        unsubscribe?.();
        unsubscribe = null;
    };

    const api = {
        snapshot: readonly(snapshot),
        devices: readonly(devices),
        error: readonly(error),
        isReady: readonly(isReady),
        isDiscovering: readonly(isDiscovering),
        isBackgroundDiscovering: readonly(isBackgroundDiscovering),
        isConnecting: readonly(isConnecting),
        isActive,
        activeDeviceName,
        discover,
        connect,
        disconnect,
    };
    return { acquire, release, api };
};

const toMessage = (cause: unknown) => {
    if (cause && typeof cause === "object" && "message" in cause) {
        const message = (cause as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message;
    }
    return "casting request failed";
};
