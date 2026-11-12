import type { BoxPlayer } from "../types/media";

const audioCodecLabels: Record<string, string> = {
    aac: "aac",
    ac3: "ac3",
    eac3: "eac3",
    "e-ac-3": "eac3",
    truehd: "truehd",
    dts: "dts",
    "dts-hd": "dts-hd",
    flac: "flac",
    alac: "alac",
    opus: "opus",
    vorbis: "vorbis",
    mp3: "mp3",
    mp2: "mp2",
    pcm: "pcm",
};

const subtitleCodecLabels: Record<string, string> = {
    ass: "ass",
    ssa: "ssa",
    subrip: "srt",
    srt: "srt",
    webvtt: "vtt",
    vtt: "vtt",
    "dvd-subtitle": "dvd",
    "hdmv-pgs-subtitle": "pgs",
    pgs: "pgs",
};

const languageCodeAliases: Record<string, string> = {
    chi: "zh",
    zho: "zh",
    cze: "cs",
    ces: "cs",
    dut: "nl",
    nld: "nl",
    eng: "en",
    fre: "fr",
    fra: "fr",
    ger: "de",
    deu: "de",
    gre: "el",
    ell: "el",
    ice: "is",
    isl: "is",
    jpn: "ja",
    kor: "ko",
    may: "ms",
    msa: "ms",
    per: "fa",
    fas: "fa",
    rum: "ro",
    ron: "ro",
    spa: "es",
    tib: "bo",
    bod: "bo",
    wel: "cy",
    cym: "cy",
};

const formatCodec = (track: BoxPlayer, labels: Record<string, string>) => {
    const rawCodec = track.codec?.trim() || track.codec_desc?.trim();
    if (!rawCodec) return "";
    const normalized = rawCodec.toLowerCase().replace(/[_\s]+/g, "-");
    return labels[normalized] ?? rawCodec.toLowerCase();
};

const formatAudioCodec = (track: BoxPlayer) =>
    formatCodec(track, audioCodecLabels);

const formatSubtitleCodec = (track: BoxPlayer) =>
    formatCodec(track, subtitleCodecLabels);

const formatAudioChannelCount = (channelCount?: number) => {
    if (
        typeof channelCount !== "number" ||
        !Number.isFinite(channelCount) ||
        channelCount <= 0
    ) {
        return "";
    }
    return `${channelCount}ch`;
};

const formatAudioChannels = (channels?: string, channelCount?: number) => {
    const value = channels?.trim();
    if (!value || /^unknown$/i.test(value)) {
        return formatAudioChannelCount(channelCount);
    }
    const normalized = value.toLowerCase();
    const unknownCountMatch = normalized.match(/^unknown\s*(\d+)$/);
    if (unknownCountMatch) {
        return formatAudioChannelCount(Number(unknownCountMatch[1]));
    }
    const channelLabels: Record<string, string> = {
        mono: "1ch",
        stereo: "2ch",
    };
    const surroundMatch = normalized.match(/^(\d+)(?:\.(\d+))?/);
    if (surroundMatch) {
        const mainChannels = Number(surroundMatch[1]);
        const subChannels = Number(surroundMatch[2] ?? 0);
        const channelCount = mainChannels + subChannels;
        return Number.isFinite(channelCount) && channelCount > 0
            ? `${channelCount}ch`
            : value;
    }
    return channelLabels[normalized] ?? value;
};

const formatAudioSampleRate = (sampleRate?: number) => {
    if (
        typeof sampleRate !== "number" ||
        !Number.isFinite(sampleRate) ||
        sampleRate <= 0
    ) {
        return "";
    }
    return `${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz`;
};

export const formatLanguageCodeTitle = (title?: string) => {
    const value = title?.trim();
    if (!value || !/^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(value)) return value ?? "";
    const normalized = value.toLowerCase();
    const displayCode = languageCodeAliases[normalized] ?? normalized;
    try {
        const displayNames = new Intl.DisplayNames(["en"], { type: "language" });
        const displayName = displayNames.of(displayCode);
        return displayName && displayName.toLowerCase() !== displayCode
            ? displayName
            : value;
    } catch {
        return value;
    }
};

export const getAudioTrackTitle = (track: BoxPlayer) =>
    /^unknown$/i.test(track.title?.trim() ?? "")
        ? ""
        : formatLanguageCodeTitle(track.title) || track.title;

export const getAudioTrackDetails = (track: BoxPlayer) =>
    [
        formatAudioCodec(track),
        formatAudioChannels(track.demux_channels, track.demux_channel_count),
        formatAudioSampleRate(track.demux_samplerate),
        track.is_default ? "Default" : "",
        track.external ? "External" : "",
    ].filter(Boolean);

export const getAudioTrackHoverTitle = (track: BoxPlayer) =>
    [getAudioTrackTitle(track), getAudioTrackDetails(track).join(" | ")]
        .filter(Boolean)
        .join(" | ");

export const getSubtitleTrackTitle = (track: BoxPlayer) =>
    String(track.id) === "0"
        ? track.title
        : formatLanguageCodeTitle(track.title) || track.title;

export const getSubtitleTrackDetails = (track: BoxPlayer) => {
    if (String(track.id) === "0") return [];
    return [
        formatSubtitleCodec(track),
        track.forced ? "Forced" : "",
        track.is_default ? "Default" : "",
        track.external ? "External" : "",
    ].filter(Boolean);
};

export const getSubtitleTrackHoverTitle = (track: BoxPlayer) =>
    [getSubtitleTrackTitle(track), getSubtitleTrackDetails(track).join(" | ")]
        .filter(Boolean)
        .join(" | ");
