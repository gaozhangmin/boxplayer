import type { CastDeviceDto } from "./generated/CastDeviceDto";
import type { CastSnapshotDto } from "./generated/CastSnapshotDto";

export type CastingClientError = {
    message: string;
};

export type CastingSnapshotListener = (snapshot: CastSnapshotDto) => void;
export type CastingDevicesListener = (devices: CastDeviceDto[]) => void;

/** Protocol-neutral client boundary for the casting Core service. */
export interface CastingClient {
    getSnapshot(): Promise<CastSnapshotDto>;
    getDevices(): Promise<CastDeviceDto[]>;
    discover(): Promise<CastDeviceDto[]>;
    connect(deviceId: string): Promise<CastSnapshotDto>;
    pause(): Promise<CastSnapshotDto>;
    play(): Promise<CastSnapshotDto>;
    seek(position: number): Promise<CastSnapshotDto>;
    stop(): Promise<CastSnapshotDto>;
    setVolume(volume: number): Promise<CastSnapshotDto>;
    disconnect(): Promise<CastSnapshotDto>;
    subscribe(
        onSnapshot: CastingSnapshotListener,
        onDevices: CastingDevicesListener,
        onError?: (error: CastingClientError) => void,
    ): () => void;
}
