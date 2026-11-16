import "./polyfills";
import { Buffer } from "buffer";
import { parseMusicHead, MUSIC_HEAD_BYTES, MUSIC_TAG_SCHEMA } from "./head";
export { MUSIC_HEAD_BYTES, MUSIC_TAG_SCHEMA, parseMusicHead };
export async function parseBase64(value: string) {
  if (value.length > Math.ceil(MUSIC_HEAD_BYTES / 3) * 4) throw new Error("Header exceeds budget");
  return parseMusicHead(Buffer.from(value, "base64"));
}
// Native JavaScriptCore/WebView hosts receive one JSON callback. No fetch, file,
// URL or credentials enter this bundle: input is always a bounded memory prefix.
export function parseNative(value: string, callback: (json: string) => void) {
  parseBase64(value).then((result) => callback(JSON.stringify(result)), () => callback(JSON.stringify({ schemaVersion: MUSIC_TAG_SCHEMA, status: "error", tags: {} })));
}

export { parseLocalFile, parseLocalNative, MUSIC_LOCAL_CHUNK_BYTES, MUSIC_LOCAL_METADATA_BYTES } from './local';
