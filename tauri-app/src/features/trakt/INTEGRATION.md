# Trakt module handoff

## Host bindings

Initialize ONE managed `Trakt::new(data_dir, backend.gateway.clone(), provider_config::client("trakt", String::new(), None).0)?`.
`SystemVault` protects the dedicated `trakt-account-v1` slot. The data directory's `trakt-vault-present` contains only a presence bit: a vault read failure after that bit exists is an error, never silently interpreted as a fresh account. Sync preferences live in the same native slot, not renderer storage.

Register these commands from `trakt.rs`:

- Main and Settings account dialogs use `trakt_status`, `trakt_account`, `trakt_connect_device_auth`, `trakt_poll`, `trakt_open`, `trakt_cancel`, `trakt_disconnect`, `trakt_settings` and `trakt_playback_progress`.
- `trakt_sync`, `trakt_public_rating`, `trakt_personal_ratings` and the legacy development command `trakt_web_start` require the main window.

Both dialogs start Trakt device authorization and show the user code. Native code opens the activation URL supplied by Trakt and polls at its interval. A new attempt replaces the previous attempt. Only the initiating window can reopen, poll or cancel the current attempt. The device code and the tokens stay native.

The legacy web command uses `boxplayer-migration-dev://trakt/callback`. That address is for an explicitly registered Trakt development client. Product dialogs use device authorization. In native `accept_open`, intercept legacy Trakt callbacks before generic routing so they stay out of renderer events and logs. Native code validates the URI and state before exchanging a legacy authorization code.

## Vue host

```vue
<TraktAccount :visible="showTrakt" @close="showTrakt=false" @progress="importProgress" />
```

`TraktAccount.vue` is the Settings overlay. The main library uses `TraktAccountModal.vue`. Both share `useTraktDeviceLogin` for starting, timing and cancelling authorization. Settings exposes `refresh()` and `sync()`.

`progress.ts` exports `playbackPatches(catalog.items, records, range)`; the parent persists `{id,patch}` through catalog update/patch. Exact external IDs only, episode season/number exact, newest remote record wins, newer local playback survives, all matching file versions are updated. Progress uses the Tauri catalog's 0–100 scale. No watched-completion inference is made from paused progress.

`client.ts` exposes the status/account refs, login/poll/cancel/settings/disconnect functions, `syncTrakt(identity, action, rating?)`, `publicTraktRating` and paginated `personalTraktRatings`. Wire application watchlist/personal-rating actions to `syncTrakt`; no player hooks are installed here. Supported mutations: watchlist-add/remove, rating (1–10), rating-remove. Public community rating remains separate from personal rating; never patch the catalog public `rating` with a user's score.

## Native Trakt HTTP

The shared Gateway calls `https://auth.trakt.tv/oauth/*` for OAuth and `https://api.trakt.tv` for account and media operations. The original BoxPlayer proxy path returned HTML in live checks. The renderer supplies neither the origin nor a client secret.

- Device code generation sends `client_id`. Polling sends `client_id` and the private device code.
- Refresh and revocation use the Trakt OAuth origin. Access tokens for account and media operations use the Authorization header on the Trakt API origin.
- The Gateway response must resolve to the requested URL. Treat malformed success responses as errors, and honor the polling interval and applicable Retry-After headers.

The official device endpoint issued a code and returned HTTP 400 while awaiting authorization using the existing app registration. Successful token exchange with a real account requires interactive approval.

## Verification

`pnpm typecheck`. Rust: `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib trakt` with this repo's local cargo/rustup setup. All HTTP in native module tests is replaced by queued synthetic responses, through the same request/response validation. No OS vault or browser is used in those tests.

Repository Vitest includes only `tests/**/*.test.ts`; scope restrictions prohibit changing that config. For progress tests use an external temporary Vitest config exporting `{test:{include:['src/features/trakt/*.test.ts'],environment:'node'}}` and `pnpm exec vitest run --config /absolute/path/to/config.mts`.

## CSP-safe avatar

`account().avatar` is now a validated `data:image/...;base64,...` URI or absent, never the remote profile URL. The native-only avatar helper fetches only the URL just read from the authenticated Trakt profile using a native bounded raster-image transport, without bearer/cookie headers. The shared Gateway follows redirects for source browsing, so this avatar-only transport explicitly disables redirects and stops the response stream at 1 MiB; Trakt JSON API calls still use the shared Gateway. It requires HTTPS without URL credentials, an unchanged final URL (redirected responses are rejected), HTTP 200, at most 1 MiB, an allowed raster MIME and matching file signature (PNG/JPEG/GIF/WebP). No SVG. Failure yields the UI placeholder. No `trakt_avatar(url)` or other arbitrary-URL command is exposed; CSP can retain its existing img-src policy. Unlike JSON API transport, this media request targets the already-read profile image address; its bytes never require a renderer external-origin request.
