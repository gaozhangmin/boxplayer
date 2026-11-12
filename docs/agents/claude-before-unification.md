<!-- 历史存档：2026-11-12 入口统一前的原文；不作为有效规则。现行入口为 ../../AGENTS.md。 -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick commands

```bash
pnpm install          # pnpm only — never npm/yarn
pnpm dev              # hot-reload Electron dev server (Vite + vue-tsc)
pnpm run build        # version bump → typecheck → vite bundle
pnpm run build:electron  # full build + electron-builder packaging
pnpm run test         # focused Vitest suite (Node env, aria2 + motrix + utils)
pnpm run test:clouddrive-cli  # clouddrive-cli tests only
pnpm run build:mac    # unsigned macOS .dmg/.zip
pnpm run build:mac:signed  # signed + notarized macOS
pnpm run build:linux  # Linux .deb/.AppImage/.pacman
pnpm run build:windows  # Windows .exe/.zip
pnpm run build:all    # cross-platform sequentially
pnpm run config:clean     # blank API keys in src/config.ts (pre-commit hook)
pnpm run config:restore   # restore real keys after commit
```

## Architecture (Electron + Vue 3 + Vite)

```
electron/main/       Electron main process (entry: electron/main/index.ts)
  core/              Window lifecycle, IPC, auto-update, protocol, dialogs
  aria/              Aria2c download engine (config, UPnP, runtime)
electron/preload/    Preload scripts (IPC bridge)

src/                 Vue 3 renderer
  aliapi/            Alibaba Cloud Drive SDK (files, share, user, etc.)
  cloudbaidu/        Baidu Netdisk provider
  cloud123/          123Pan provider
  cloud115/          115Pan provider
  pikpak/            PikPak provider
  onedrive/          OneDrive provider
  dropbox/           Dropbox provider
  box/               Box provider
  quark/             Quark provider
  cloud139/          CMCloud provider
  cloud189/          Tianyi Cloud provider
  pan/               File manager UI (tree, menus, dialogs)
  media-server/      Jellyfin/Emby/Plex integration
  down/              Download manager + Aria2 integration
  layout/            Main layout views (PageVideo, PageMusic, etc.)
  module/            Feature modules (audioplayer, musicsdk, lyricplayer, theme)
  store/             Pinia stores
  components/        Shared Vue components
  utils/             Shared utilities
  user/              Auth, account management UI

shared/              Code shared between main + renderer (constants, config keys, UA)
scripts/             Build scripts, CLI entry points (clouddrive-cli.mjs, clouddrive-mcp.mjs)
clouddrive-cli/      Standalone CLI + MCP server package (npm: clouddrive-cli)
  core/              Command implementations, MCP server, upload planning
  providers/         8 cloud-drive provider implementations
  media/             Media matching + rename logic
```

Path aliases: `@shared/*` → `shared/*`, `@main/*` → `electron/main/*`

## Key patterns

- **pnpm only** — lockfile is `pnpm-lock.yaml`; `package-lock.json`/`yarn.lock` are gitignored
- **Node ≥ 18**
- **Pre-commit hooks** (`nano-staged.mjs`): prettier + eslint on JS/TS, stylelint + prettier on Vue/CSS, typecheck on changed `src/` files
- **Formatting**: single quotes, no semicolons, 260 printWidth, no trailing commas, LF, `sortAttributes: true` in Vue
- **TypeScript**: strict mode, ESNext target, node moduleResolution
- **Sensitive config**: `scripts/clean-config.js` blanks API keys pre-commit; restore with `pnpm run config:restore`
- **Vitest**: Node environment only, explicit test directory list in `vitest.config.ts` (not glob patterns). Add new test dirs to config.
- **CI**: Manual trigger only via `.github/workflows/release.yml`, publishes draft GitHub Release

## clouddrive-cli (AI agent integration)

Standalone CLI + MCP server for agent-driven cloud-drive operations. Supports 8 providers: aliyun, cloud123, 115, baidu, pikpak, onedrive, box, dropbox.

Key bins: `clouddrive-cli` (CLI), `clouddrive-mcp` (MCP server). Both point to `scripts/clouddrive-cli.mjs` and `scripts/clouddrive-mcp.mjs` respectively.

Agent rules when using the CLI:
1. Discover commands first: `clouddrive-cli list --format json`
2. Check capabilities: `clouddrive-cli providers capabilities --format json`
3. Always dry-run before destructive ops
4. Never invent file IDs — they must come from `files list`/`walk`/`search`/`tree`
5. Use `--output <file.json>` for large results

## Adding a new cloud-drive provider

Follow the 15-step checklist in `AGENT.md` (OAuth → provider detection → file listing → download/playback → search → thumbnails → file operations → sharing → upload → media scan → folder picker → menu boundaries → properties/recycle bin → tests → verification). The checklist is authoritative — do not ship a provider that only does file listing.
