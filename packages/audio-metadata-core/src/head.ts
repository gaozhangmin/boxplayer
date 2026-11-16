import { parseBuffer, type ICommonTagsResult } from "music-metadata";
import { Buffer } from "buffer";

export const MUSIC_HEAD_BYTES = 1024 * 1024;
export const MUSIC_TAG_SCHEMA = 1;
export interface MusicHeadTags {
  durationSec?: number; sampleRate?: number; channels?: number; bitrate?: number; codec?: string;
  title?: string; artists?: string[]; album?: string; albumArtists?: string[];
  genres?: string[]; trackNumber?: number; discNumber?: number; releaseDate?: string;
  musicBrainzRecordingID?: string; musicBrainzReleaseID?: string; isrc?: string[];
  replayGainTrack?: number; replayGainAlbum?: number; lyrics?: string; artworkDataURL?: string;
}
export interface MusicHeadResult { schemaVersion: number; status: "parsed" | "no-tags" | "truncated" | "unsupported"; tags: MusicHeadTags }

// Keep only metadata preceding audio. A small complete file must not accidentally
// make trailing ID3v1/APEv2 or a post-mdat moov visible to the library.
function leadingMetadata(bytes: Buffer): { bytes: Buffer; extension: string; complete: boolean } | undefined {
  if (bytes.subarray(0, 3).toString() === "ID3") {
    if (bytes.length < 10) return { bytes: Buffer.alloc(0), extension: ".mp3", complete: false };
    const size = bytes.subarray(6, 10);
    if ([...size].some((n) => n > 127)) throw new Error("Invalid ID3 size");
    const end = 10 + size.reduce((sum, n) => (sum << 7) + n, 0);
    return { bytes: bytes.subarray(0, Math.min(end, bytes.length)), extension: ".mp3", complete: end <= bytes.length };
  }
  if (bytes.subarray(0, 16).equals(Buffer.from("3026b2758e66cf11a6d900aa0062ce6c", "hex"))) {
    if (bytes.length < 30) return { bytes: Buffer.alloc(0), extension: ".wma", complete: false };
    const length = bytes.readBigUInt64LE(16);
    if (length < 30n) throw new Error("Invalid ASF header size");
    if (length > BigInt(bytes.length)) return { bytes: Buffer.alloc(0), extension: ".wma", complete: false };
    return { bytes: bytes.subarray(0, Number(length)), extension: ".wma", complete: true };
  }
  const magic = bytes.subarray(0, 4).toString();
  if (magic === "fLaC") {
    let offset = 4;
    while (offset + 4 <= bytes.length) {
      const last = (bytes[offset]! & 128) !== 0;
      const end = offset + 4 + bytes.readUIntBE(offset + 1, 3);
      if (end > bytes.length) return { bytes: bytes.subarray(0, offset), extension: ".flac", complete: false };
      offset = end;
      if (last) return { bytes: bytes.subarray(0, offset), extension: ".flac", complete: true };
    }
    return { bytes: bytes.subarray(0, offset), extension: ".flac", complete: false };
  }
  if (bytes.subarray(4, 8).toString() === "ftyp") {
    let offset = 0;
    while (offset + 8 <= bytes.length) {
      let size = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString();
      if (type === "mdat") return { bytes: bytes.subarray(0, offset), extension: ".m4a", complete: true };
      if (size === 1) {
        if (offset + 16 > bytes.length) break;
        const large = bytes.readBigUInt64BE(offset + 8);
        if (large > BigInt(MUSIC_HEAD_BYTES)) break;
        size = Number(large);
      }
      if (size < 8 || offset + size > bytes.length) break;
      offset += size;
      if (type === "moov") return { bytes: bytes.subarray(0, offset), extension: ".m4a", complete: true };
    }
    return { bytes: bytes.subarray(0, offset), extension: ".m4a", complete: false };
  }
  if (magic === "RIFF" || magic === "FORM") {
    const extension = magic === "RIFF" ? ".wav" : ".aiff";
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = bytes.subarray(offset, offset + 4).toString();
      if (type === "data" || type === "SSND") return { bytes: bytes.subarray(0, offset), extension, complete: true };
      const size = magic === "RIFF" ? bytes.readUInt32LE(offset + 4) : bytes.readUInt32BE(offset + 4);
      const end = offset + 8 + size + (size % 2);
      if (end > bytes.length) break;
      offset = end;
    }
    return { bytes: bytes.subarray(0, offset), extension, complete: false };
  }
  if (magic === "OggS") {
    // Retain only leading header pages (Vorbis identification/comment/setup,
    // OpusHead/OpusTags). Stop before the first audio packet, even in one page.
    let offset = 0, packets = 0;
    const opus = bytes.subarray(0, Math.min(bytes.length, 128)).includes(Buffer.from("OpusHead"));
    const headerPackets = opus ? 2 : 3;
    while (offset + 27 <= bytes.length && bytes.subarray(offset, offset + 4).toString() === "OggS") {
      const count = bytes[offset + 26]!;
      if (offset + 27 + count > bytes.length) break;
      const segments = bytes.subarray(offset + 27, offset + 27 + count);
      const end = offset + 27 + count + segments.reduce((sum, n) => sum + n, 0);
      if (end > bytes.length) break;
      for (const size of segments) if (size < 255) packets++;
      offset = end;
      if (packets >= headerPackets) return { bytes: bytes.subarray(0, offset), extension: opus ? ".opus" : ".ogg", complete: true };
    }
    return { bytes: bytes.subarray(0, offset), extension: opus ? ".opus" : ".ogg", complete: false };
  }
  return undefined;
}

export function normalizedTags(common: ICommonTagsResult, includeArtwork: boolean, artworkLimit = 256 * 1024): MusicHeadTags {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  const list = (values?: string[]) => {
    const result = values?.map(text).filter((value): value is string => !!value);
    return result?.length ? result : undefined;
  };
  const artwork = includeArtwork ? common.picture?.find((picture) => picture.data.length <= artworkLimit && /^image\/(jpeg|png|webp)$/i.test(picture.format)) : undefined;
  return {
    title: text(common.title), artists: list(common.artists ?? (common.artist ? [common.artist] : undefined)),
    album: text(common.album), albumArtists: list(common.albumartists ?? (common.albumartist ? [common.albumartist] : undefined)),
    genres: list(common.genre), trackNumber: common.track?.no ?? undefined, discNumber: common.disk?.no ?? undefined,
    releaseDate: text(common.date) ?? (common.year ? String(common.year) : undefined),
    musicBrainzRecordingID: text(common.musicbrainz_recordingid), musicBrainzReleaseID: text(common.musicbrainz_albumid),
    isrc: list(common.isrc), replayGainTrack: common.replaygain_track_gain?.dB, replayGainAlbum: common.replaygain_album_gain?.dB,
    lyrics: common.lyrics?.map((lyric) => lyric.text ?? lyric.syncText?.map((line) => line.text).join("\n")).filter(Boolean).join("\n") || undefined,
    artworkDataURL: artwork ? `data:${artwork.format};base64,${Buffer.from(artwork.data).toString("base64")}` : undefined,
  };
}

export async function parseMusicHead(bytes: Buffer, includeArtwork = true): Promise<MusicHeadResult> {
  if (bytes.length > MUSIC_HEAD_BYTES) throw new Error("Music header exceeds byte budget");
  const head = leadingMetadata(bytes);
  if (!head) return { schemaVersion: MUSIC_TAG_SCHEMA, status: "unsupported", tags: {} };
  if (!head.complete && (head.extension === ".mp3" || head.extension === ".wma")) return { schemaVersion: MUSIC_TAG_SCHEMA, status: "truncated", tags: {} };
  let common: ICommonTagsResult | undefined;
  try {
    const metadata = await parseBuffer(head.bytes, { path: `head${head.extension}` }, {
      duration: false, skipPostHeaders: true, skipCovers: !includeArtwork,
      maxMemoryAllocation: MUSIC_HEAD_BYTES, maxMetadataEntries: 4096,
      observer: (update) => { common = update.metadata.common; },
    });
    common = metadata.common;
  } catch (error) {
    // A prefix intentionally has no audio frames. Preserve tags already parsed
    // from complete leading blocks, but do not hide structural parse failures.
    if (!(error instanceof Error) || !/end.of.stream|end of file|EOF/i.test(`${error.name} ${error.message}`)) throw error;
  }
  const tags = common ? normalizedTags(common, includeArtwork) : {};
  const hasTags = Object.values(tags).some((value) => Array.isArray(value) ? value.length > 0 : value !== undefined);
  return { schemaVersion: MUSIC_TAG_SCHEMA, status: !head.complete ? "truncated" : hasTags ? "parsed" : "no-tags", tags };
}
