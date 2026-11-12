# Trakt module handoff

Scope: new files only. No Electron token import, user credential reads, real login or player changes.

## Host bindings

Initialize ONE managed `Trakt::new(data_dir, backend.gateway.clone(), provider_config::client("trakt", String::new(), None).0)?`.
`SystemVault` protects the dedicated `trakt-account-v1` slot. The data directory's `trakt-vault-present` contains only a presence bit: a vault read failure after that bit exists is an error, never silently interpreted as a fresh account. Sync preferences live in the same native slot, not renderer storage.

Register these commands from `trakt.rs`:

- `trakt_status`, `trakt_account`
- `trakt_web_start` (DEFAULT login), `trakt_connect_device_auth` (explicit fallback), `trakt_poll`, `trakt_cancel`
- `trakt_disconnect`, `trakt_settings`, `trakt_sync`, `trakt_playback_progress`, `trakt_open`
- `trakt_public_rating`, `trakt_personal_ratings`

All command wrappers require the `main` webview. Webview capabilities must not expose these commands to external/player windows.

DEFAULT login matches CURRENT Electron `TraktAccountModal -> startTraktLogin -> electron/main/trakt.ts webLogin`: system browser, S256 PKCE, random native verifier/state, native token exchange. Development callback is **`boxplayer-migration-dev://trakt/callback`**, deliberately NOT the production `boxplayer-traktoauth` scheme. Trakt's client redirect allowlist must explicitly contain this development URI. Existing production redirect registration does not prove support. No real login/redirect acceptance has been tested.

In native `accept_open`, intercept the development callback BEFORE generic OpenInbox routing/logging. Call `app.state::<trakt::Trakt>().callback(target).await`. Do NOT emit the URL to JS or log the target. The method returns false for unrelated URI/state, true after a valid exchange, or a sanitized AppError. Polling exposes only pending/connected; code, verifier, state and tokens never cross IPC. Errors from callback should not include the raw URL. No new callback command is needed.

Cancel increments native generation immediately even while an exchange holds the lock. Completion checks generation before publishing credentials and compensates a cancellation racing the vault write. Browser authorization expires after ten minutes. Duplicate state/code, wrong URI, fragments, denied callbacks and stale attempts are rejected.

## Vue host

```vue
<TraktAccount :visible="showTrakt" @close="showTrakt=false" @progress="importProgress" />
```

`TraktAccount.vue` is the standalone overlay (no nested host dialog). It supplies profile/avatar fallback, VIP, episodes/shows/movies statistics, refresh/retry, disconnect, sync switch, all/7/30/180/365-day ranges, DEFAULT web login and explicit device-code fallback. `defineExpose` offers `refresh()` and `sync()`.

`progress.ts` exports `playbackPatches(catalog.items, records, range)`; the parent persists `{id,patch}` through catalog update/patch. Exact external IDs only, episode season/number exact, newest remote record wins, newer local playback survives, all matching file versions are updated. Progress uses the Tauri catalog's 0–100 scale. No watched-completion inference is made from paused progress.

`client.ts` exposes the status/account refs, login/poll/cancel/settings/disconnect functions, `syncTrakt(identity, action, rating?)`, `publicTraktRating` and paginated `personalTraktRatings`. Wire application watchlist/personal-rating actions to `syncTrakt`; no player hooks are installed here. Supported mutations: watchlist-add/remove, rating (1–10), rating-remove. Public community rating remains separate from personal rating; never patch the catalog public `rating` with a user's score.

## Fixed publicAPI proxy contract — backend confirmation required

Native HTTP uses existing `Gateway` and the fixed origin `https://api.xbyvideohub.com`. The implemented prefix is `/api/trakt` followed by the canonical Trakt path/query. There is no renderer-supplied origin, secret or redirect URI.

The inspected local `boxplayer-api/server` currently contains no Trakt handler. This is a required backend contract, NOT a claim that the route is deployed. No live requests were made to verify it.

Proxy must forward **without wrapping** response JSON/status and preserve Retry-After:

- `/api/trakt/oauth/*` -> `https://auth.trakt.tv/oauth/*`.
- All other `/api/trakt/*` -> `https://api.trakt.tv/*`.
- Preserve HTTP GET/POST, JSON request body, native `Authorization: Bearer ...`, `trakt-api-key: <client ID>`, `trakt-api-version: 2`, `Content-Type: application/json`.
- Device code/token bodies have `client_id`, and token has `code` (private device code).
- Web token exchange has `client_id`, `code`, `code_verifier`, `redirect_uri`, `grant_type: authorization_code`.
- Refresh has `client_id`, `refresh_token`, `grant_type: refresh_token`; revoke has `client_id`, `token`.
- No client_secret is sent, matching Electron's public-client flow. Do not substitute an API-envelope response for raw Trakt payloads.
- Keep OAuth/Authorization bodies and callbacks out of proxy logs/caches. Do not redirect the native credential-bearing request.

The browser authorize URL is `https://auth.trakt.tv/oauth/authorize` (same as Electron), opened natively. Browser navigation is distinct from native API proxy transport.

If the backend uses a different actual proxy prefix or envelope, reconcile it here before login acceptance; do not silently fall back to direct API calls. `configured=true` currently means native Client ID exists, not that proxy/redirect allowlist passed live verification.

## Verification

`pnpm typecheck`. Rust: `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib trakt` with this repo's local cargo/rustup setup. All HTTP in native module tests is replaced by queued synthetic responses, through the same request/response validation. No OS vault or browser is used in those tests.

Repository Vitest includes only `tests/**/*.test.ts`; scope restrictions prohibit changing that config. For progress tests use an external temporary Vitest config exporting `{test:{include:['src/features/trakt/*.test.ts'],environment:'node'}}` and `pnpm exec vitest run --config /absolute/path/to/config.mts`.

## CSP-safe avatar

`account().avatar` is now a validated `data:image/...;base64,...` URI or absent, never the remote profile URL. The native-only avatar helper fetches only the URL just read from the authenticated Trakt profile using a native bounded raster-image transport, without bearer/cookie headers. The shared Gateway follows redirects for source browsing, so this avatar-only transport explicitly disables redirects and stops the response stream at 1 MiB; Trakt JSON API calls still use the shared Gateway. It requires HTTPS without URL credentials, an unchanged final URL (redirected responses are rejected), HTTP 200, at most 1 MiB, an allowed raster MIME and matching file signature (PNG/JPEG/GIF/WebP). No SVG. Failure yields the UI placeholder. No `trakt_avatar(url)` or other arbitrary-URL command is exposed; CSP can retain its existing img-src policy. Unlike JSON API transport, this media request targets the already-read profile image address; its bytes never require a renderer external-origin request.
