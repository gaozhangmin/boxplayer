# BoxPlayer shared local music metadata core

Canonical source for **all four client checkouts**. music-metadata 12.5.0 parses a bounded in-memory prefix. No file bytes are uploaded to an API. Native transports retain account headers and expose at most 1 MiB starting at byte zero; no suffix ranges, following end pointers, full-file downloads or duration scans are permitted.

`src/head.ts` separates leading tag/container blocks from audio before calling the parser. It accepts leading ID3v2, WMA/ASF header objects, FLAC metadata, Ogg Vorbis/Opus header pages, MP4 moov before mdat, and RIFF/AIFF chunks before audio. It does not follow ID3v1/APEv2, post-mdat moov, DSF end pointers, or other trailing tags. Missing/truncated/unsupported tags are distinct from corrupt input. Artwork is optional, must fit in the head budget and is returned only up to 256 KiB. Multi-artists, album artists, track/disc numbers, lyrics, MusicBrainz IDs, ISRC and ReplayGain share one normalized JSON schema. Duration is not inferred by scanning audio.

The browser bundle includes text decoding for JavaScriptCore. Electron/Tauri run it locally in their web runtime; Apple uses JavaScriptCore; Android uses a network-disabled WebView on scan workers. Platform code only reads bounded bytes and maps JSON fields to storage. It must not introduce another ID3/FLAC parser or provider matching algorithm.

```sh
pnpm install --ignore-workspace --frozen-lockfile
pnpm build
pnpm test
pnpm sync
pnpm check
```

`sync.mjs` distributes identical script, manifest and dependency notices to Electron, Tauri, Android assets and Apple resources. `check` compares every byte. Build from this directory only; do not edit generated copies. Local head tests run in a JS VM without network, filesystem, streams, Buffer, TextDecoder or TextEncoder globals. This is not native device acceptance.

Online catalogs and lyric matching live in boxplayer-api (`/api/music/metadata`, `/api/music/lyrics`); clients send search text and optional playback duration, never audio headers. User/local lyrics and embedded fields take precedence. Tauri's new music adapter is ready for M7; its current video-only library does not yet expose a music library flow.
