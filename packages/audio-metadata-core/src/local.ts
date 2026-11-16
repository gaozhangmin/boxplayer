import { parseFromTokenizer } from 'music-metadata';
import { AbstractTokenizer, EndOfStreamError, type IReadChunkOptions } from 'strtok3/core';
import { Buffer } from 'buffer';
import { normalizedTags, MUSIC_TAG_SCHEMA, type MusicHeadResult } from './head';

export const MUSIC_LOCAL_CHUNK_BYTES = 64 * 1024;
// This bounds one metadata allocation, not the audio file size or read offset.
export const MUSIC_LOCAL_METADATA_BYTES = 64 * 1024 * 1024;
export type LocalReader = (position: number, length: number) => Promise<Uint8Array> | Uint8Array;
class LocalTokenizer extends AbstractTokenizer {
  readonly fileInfo: {size: number; path: string};
  constructor(size: number, path: string, private readonly read: LocalReader) {
    super({ maxBufferSize: MUSIC_LOCAL_METADATA_BYTES });
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid local file size');
    this.fileInfo = { size, path };
  }
  supportsRandomAccess() { return true; }
  setPosition(position: number) { this.validateLength(position, 'position'); this.position = position; }
  async readBuffer(buffer: Uint8Array, options?: IReadChunkOptions) {
    const opts = this.normalizeOptions(buffer, options);
    const count = await this.peekBuffer(buffer, opts);
    this.position = opts.position + count;
    return count;
  }
  async peekBuffer(buffer: Uint8Array, options?: IReadChunkOptions) {
    const opts = this.normalizeOptions(buffer, options);
    this.validateBufferSize(opts.length);
    const length = Math.max(0, Math.min(opts.length, this.fileInfo.size - opts.position));
    if (!opts.mayBeLess && length < opts.length) throw new EndOfStreamError();
    let count = 0;
    while (count < length) {
      const requested = Math.min(MUSIC_LOCAL_CHUNK_BYTES, length - count);
      const bytes = await this.read(opts.position + count, requested);
      if (!bytes.length || bytes.length > requested) throw new EndOfStreamError();
      buffer.set(bytes, count); count += bytes.length;
    }
    return count;
  }
}

/** Local random-access parsing: follows trailing tags and post-audio metadata. */
export async function parseLocalFile(size: number, name: string, read: LocalReader): Promise<MusicHeadResult> {
  const tokenizer = new LocalTokenizer(size, name, read);
  try {
    const metadata = await parseFromTokenizer(tokenizer, {
      duration: true, skipPostHeaders: false, skipCovers: false,
      maxMemoryAllocation: MUSIC_LOCAL_METADATA_BYTES, maxMetadataEntries: 100000,
    });
    const tags = normalizedTags(metadata.common, true, MUSIC_LOCAL_METADATA_BYTES);
    Object.assign(tags, { durationSec: metadata.format.duration, sampleRate: metadata.format.sampleRate,
      channels: metadata.format.numberOfChannels, bitrate: metadata.format.bitrate, codec: metadata.format.codec });
    const present = Object.values(tags).some(value => value !== undefined);
    return { schemaVersion: MUSIC_TAG_SCHEMA, status: present ? 'parsed' : 'no-tags', tags };
  } finally { await tokenizer.close(); }
}

export function parseLocalNative(size: number, name: string,
  readBase64: (position: number, length: number) => string | Promise<string>, callback: (json: string) => void) {
  parseLocalFile(size, name, async (position, length) => Buffer.from(await readBase64(position, length), 'base64'))
    .then(result => callback(JSON.stringify(result)), () => callback(JSON.stringify({ schemaVersion: MUSIC_TAG_SCHEMA, status: 'error', tags: {} })));
}
