// Type only; no upstream mock data is imported.
export type MediaInfo = {
    title: string;
    path: string;
    container: string;
    size: string;
    duration: string;
    badges: string[];
    video: {
        codec: string;
        resolution: string;
        fps: string;
        bitRate: string;
        color: string;
        aspect: string;
    };
    audio: {
        codec: string;
        channels: string;
        sampleRate: string;
        language: string;
    };
    subtitles: string[];
};
