# Third-party sources and components

This development shell is GPL-3.0-only. The M1 shell is locally authored. M2 incorporates adapted GPL source and a development-only libmpv runtime as described below.

The local `src/components/ui/button` composition follows the public shadcn-vue component pattern (MIT), using Reka UI Primitive and class-variance-authority; it has been adapted to this project's props and visual tokens. The generator configuration is `components.json`, aligned with Tailwind CSS 4. This is not a vendored copy of an entire shadcn-vue release.

Primary dependencies: Tauri and its official plugins (MIT OR Apache-2.0), Vue and Pinia (MIT), Reka UI and shadcn-vue (MIT), Tailwind CSS (MIT), lucide-vue-next (ISC), vue-sonner (MIT), class-variance-authority (Apache-2.0), clsx and tailwind-merge (MIT). Exact installed versions are recorded in pnpm-lock.yaml and Cargo.lock; consult each installed package/crate license for the authoritative text. M9 must collect distributable notices for the actual bundled dependency set.

Implementation references: https://v2.tauri.app/ and https://www.shadcn-vue.com/docs/installation/vite . Local read-only architectural references: soia baec808, Frame 5a05260, and cc-switch (directory snapshot without Git metadata).

## M2 player source and runtime

The player UI is directly vendored from FengZeng/soia commit `baec8081dc1ae371f21ca79ddb4a30e1d9269b5c` under `src/vendor/soia/`, GPL-3.0-only. It includes PlayerHeader, PlayerControls, LeftControls, RightControls, SeekBar, ControlSlider, SideActionsNav, PlaylistDrawer, ContextMenu, CastDevicePopover and their styles/types/utilities. UI templates, SVG icons and styles remain upstream. The only edits in upstream files are native import redirection in PlayerHeader/RightControls and widening the discovery callback's event type in useCasting. The source hashes and verification script record these exceptions. Compatibility modules and `src/features/player/soia/` connect native calls to BoxPlayer; they do not import upstream mock business data or credential storage. The small formatTime helper and Rust libmpv C ABI/ownership definitions also derive from soia. License text: `licenses/soia-GPL-3.0.txt`. BoxPlayer owns the worker, NSView host, HTTP gateway and persistence. The proprietary soia_utils library, protocols and authentication services are not imported, linked or loaded.

The macOS development bundle uses the patched mpv v0.41.0 runtime already installed with Frame Player. `scripts/prepare-mpv-runtime.mjs` copies the runtime and its LICENSE/THIRD-PARTY-NOTICES.md into ignored `.local/runtime/macos/`; no Frame wrapper library is used. Runtime files are bundled in `Contents/Resources/runtime/`, with SHA-256 hashes in `runtime-manifest.json`. Frame source reference: commit `5a05260`. This is local development verification, not proof that these exact binaries were built from that commit. A pinned, reproducible source build and complete redistributable notices remain release work in M9. See the M2 validation report in the migration docs for evidence and limits.

M2 adds rusqlite/SQLite, reqwest/rustls, Tokio, axum, libloading, SHA-256 and UUID dependencies. Authoritative versions and licenses are in Cargo.lock and installed crate metadata. This summary is not the final release dependency inventory.

`src-tauri/src/player/hdr.rs` also adapts soia baec808 `mpv/hdr_output.rs` (GPL-3.0-only): property application/restoration is connected to BoxPlayer's direct libmpv worker, with no soia_utils or private brightness calls. The sample tests and debug audit do not establish physical HDR luminance or native Dolby Vision signalling.

## M3 account and source infrastructure

M3 adds keyring 3.6.3 (MIT OR Apache-2.0) for platform credential storage and base64 0.22 (MIT OR Apache-2.0) for PKCE encoding. Exact dependency versions are in Cargo.lock. Protocol slices in src/features/sources are adapted from this repository's existing GPL-3.0 Electron provider/media-server implementations; Electron store, UI and direct fetch dependencies are replaced by Tauri account/transport boundaries. This does not constitute verification of provider account access or completion of all provider capabilities.

M3 adds qrcode 1.5.4 (MIT) for local QR generation, adapted 115 device flow from this repository’s utils/drive115.ts and protocol files (GPL-3.0). No third-party QR rendering service is used.

M3 adds reqwest_cookie_store 0.9 / cookie_store 0.22 (MIT OR Apache-2.0), reuses ring 0.17 directly for AES-256-GCM and OS randomness (see ring's packaged LICENSE for its mixed notices). Quark protocol code adapts this repository's src/quark/auth.ts and dirfilelist.ts. Cookie values and encrypted credential contents are excluded from reports.

M3 device-authentication primitives additionally use RustCrypto k256 0.13.4 (Apache-2.0 OR MIT), with versions pinned in Cargo.lock. The new Aliyun web-auth boundary is work in progress and is not a claim of real-account acceptance.

The non-player UI uses the locally installed Infuse macOS application as a visual reference. No Infuse source code, logos, poster artwork or UI images are bundled in the app. Comparison screenshots in migration documentation are reference evidence only; BoxPlayer retains its own icon, green accent, existing provider assets and lucide icons.

M3 PikPak protocol primitives use RustCrypto md-5 0.10.6 (MIT OR Apache-2.0), locked in Cargo.lock. SDK signature constants and protocol orchestration are adapted from this repository’s GPL-3.0 src/pikpak implementation; account credentials and application registration are not part of these notices.

M3 139 request timestamps use chrono 0.4.45 (MIT OR Apache-2.0), already present transitively and now declared directly; token/signing and routing protocols adapt this repository’s GPL-3.0 src/cloud139 implementation.

M3 Tianyi QR HTML extraction declares regex 1.13.1 (MIT OR Apache-2.0), already present transitively. HMAC-SHA1 uses ring’s legacy interoperability primitive solely for the retained Tianyi API protocol; no session secrets are distributed as assets.

M3 playbackQuality.ts is a pure policy copy adapted from this repository’s GPL-3.0 media-server implementation. HLS URI sealing reuses the existing ring AES-256-GCM dependency; no upstream session keys or user media are packaged as fixtures.

## Original boxplayer persistence host

`native/boxplayer/upstream/` retains the original workflow repository and dependencies from BoxPlayer's vendored boxplayer-workflow; original Electron service/host fragments and exact-file hashes are recorded in `native/boxplayer/upstream.json`. This phase migrates storage and DTO projection, not the model or provider execution layer. The standalone host is compiled with the locally installed Bun runtime (current build: 1.4.4), including its SQLite support; users do not install a separate runtime. Collect Bun and its bundled third-party runtime notices for the actual release binary in M9, alongside the existing mpv/runtime inventory. This development bundle is not a final redistribution-notice audit.

The BoxPlayer acquisition engine now also incorporates the original worker, Agent/tool sandbox, resource/metadata providers, protected storage factory, and complete task service. Runtime identifiers and application branding are normalized to BoxPlayer; original source names, hashes and text remain in the offline source-audit archive for provenance and licensing. The archive is not a runtime resource. Added dependencies use the original engine's versions: AI SDK 6.0.209, OpenAI-compatible provider 2.0.51 and Zod 4.4.3; authoritative versions/licenses are in pnpm-lock.yaml and installed package metadata. Native runtime account/model ports remain unbound in this development phase.

M4 adds a native `mscache` artwork cache and portable video-library migration adapters authored for BoxPlayer. The transition exporter reads only a caller-selected media-table copy through the IndexedDB API; `fake-indexeddb` is a development-only dependency used to verify the old Electron table schema without accessing user accounts. It is not imported by the application runtime. Authoritative development dependency versions/licenses are recorded in pnpm-lock.yaml and installed package metadata.
