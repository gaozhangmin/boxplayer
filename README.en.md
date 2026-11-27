<div align="center">

<a href="https://xbyvideohub.com/"><img src="screenshot/icon.svg" width="104" alt="BoxPlayer icon"></a>

# BoxPlayer

**One library for the media on your drives, cloud storage, NAS, and media servers.**

Watch movies and shows, listen to music, and read on computers, phones, tablets, and TVs. The rebuilt Tauri desktop app adds a cloud drive Agent that turns searches, filing, and batch renames into plans you can review item by item.

[![GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/gaozhangmin/boxplayer)](https://github.com/gaozhangmin/boxplayer/stargazers)

**[Download](#download)** · **[Quick start](#quick-start)** · **[Cloud drive Agent](#cloud-drive-agent)** · **[Docs](#docs)** · **[Community](#community)** · [简体中文](README.md) · **English**

<img src="screenshot/readme/movie-detail.png" width="1000" alt="WALL-E in BoxPlayer Tauri, showing movie artwork, details, cast, and the play button">

<sub>Captured in the macOS Tauri development app. Movie artwork and information are from TMDB.</sub>

</div>

> **The first Tauri release is in preparation.** The screenshots show the development app, where the Agent and related features are still being integrated. See the [first-release tracker #540](https://github.com/gaozhangmin/boxplayer/issues/540) for platform support, features, and installers.

## Download

| Device | Where to get it |
| --- | --- |
| iPhone, iPad, Mac, Apple TV | [App Store](https://apps.apple.com/us/app/boxplayer/id6739804060) |
| Android phones and tablets, Android TV | [BoxPlayer website](https://xbyvideohub.com/) |
| Windows, Linux, and macOS desktop | [GitHub Releases · Published desktop builds](https://github.com/gaozhangmin/boxplayer/releases) |
| Tauri desktop development app | [First-release tracker](https://github.com/gaozhangmin/boxplayer/issues/540) · [Run locally](#tauri-desktop) |

Supported sources, formats, and features vary by client and version.

## Quick start

1. **Add a source.** In Files, add a local folder, sign in to a cloud drive, or connect a media server such as Emby, Jellyfin, or Plex.
2. **Open a file or build a library.** Select a video to play it directly, or scan a media folder to browse its movies and shows by poster, season, and category.
3. **Pick up where you left off.** Resume from Continue Watching, or save the titles you return to in Favorites and playlists.

<img src="screenshot/readme/media-library.png" width="1000" alt="BoxPlayer Tauri media library showing the poster wall for movies and collections">

## Cloud drive Agent

In the Tauri development app, open **AI Assistant** from Files to work with the current folder and selected files. You can also hand off a movie or show from its detail page. Lock the context to keep the task scoped to the same folder while browsing elsewhere.

<img src="screenshot/readme/drive-agent.png" width="1000" alt="BoxPlayer Tauri cloud drive Agent showing conversations, Recipes, the prompt box, and tabs for plan diffs, acquisition, and run evidence">

### Example of organizing a series by season

> Review the current series folder. Group episodes by season and rename the files you can identify using a pattern like `Show.S01E01.ext`. Preview the changes first and list files with uncertain episode numbers.

1. **Set the scope.** Open the series folder and lock the context. Select individual files first if you only want to organize a few episodes.
2. **Review the plan.** In the plan diff, check the original paths, destinations, and new filenames. Uncheck any proposed change you want to leave out.
3. **Apply and verify.** Approve and run the selected changes. The Agent rechecks the source and destination before writing. Review the receipts in the run evidence panel and undo eligible changes if needed.

### What you can do with the Agent

| Task | How to use it |
| --- | --- |
| Find files and inspect folders | Find a title or summarize folder contents, sizes, or available space. Search coverage depends on your sources. |
| File media and batch rename | Use a Recipe to file movies, group episodes by season, or rename files in bulk, then review the plan. |
| Import a share | Inspect the share, choose files and a destination, and submit a plan. Import support varies by provider. |
| Find sources and track episodes | Hand a title off to MediaScout and follow candidates and task results in Acquisition and Inspection. |
| Repeat a workflow | Save a Recipe or schedule an inspection that generates a plan for review. |

Search, upload, import, and write operations depend on the provider and account permissions. The development app supports bring-your-own-key (BYOK) model access. The optional local MCP service is off by default and uses local pairing when enabled. Write proposals from external clients still require approval in BoxPlayer.

## Video, music, books, and files

### Playback and library

Open video directly from cloud drives, local network shares, and media servers. Scan movie and TV folders for posters, descriptions, and season and episode information. Switch audio and subtitle tracks, adjust playback speed, and use sidecar subtitles or an external player where supported.

### Cloud drives, network shares, and transfers

| Source | Examples |
| --- | --- |
| Cloud drives | Aliyun Drive, Baidu Netdisk, 115, 123Pan, Quark, Tianyi Cloud, Google Drive, OneDrive, Dropbox |
| Local and network files | Local folders, SMB, NFS, WebDAV, AList |
| Media servers | Emby, Jellyfin, Plex |

Browse multiple sources from Files. Upload, download, and import shares on supported drives, and track those transfers in the app.

<img src="screenshot/readme/connect-sources.png" width="680" alt="BoxPlayer Tauri source picker showing local folders, network protocols, and cloud services">

### Music, books, and documents

Browse music by song, artist, album, or playlist, manage the queue, and see lyrics in supported players. Read EPUB and PDF books and save bookmarks, notes, and reading progress. Supported clients also offer document previews and Q&A. Hosted AI features are available in corresponding BoxPlayer Pro versions.

<img src="screenshot/readme/music-library.png" width="1000" alt="BoxPlayer Tauri music library showing categories, a track list, and playback controls">

## Tauri desktop

The new desktop app is a rebuild of the Electron app using **Tauri 2**. Vue runs in the system WebView. Rust provides native windows, storage, and media access, and the macOS development app embeds libmpv. The new desktop source lives in [`tauri-app/`](tauri-app/) on the default `main` branch. The previous desktop project is on the [`electron` branch](https://github.com/gaozhangmin/boxplayer/tree/electron).

To run the native development app, install Node.js 22.12 or later, pnpm 10.32.1, the Bun version pinned by `@types/bun`, Rust, and your platform's Tauri prerequisites. Store app registration in `tauri-app/.local/provider-registration.ts` or set `BOXPLAYER_REGISTRATION_FILE` to your registration file. See the [desktop development guide](tauri-app/README.md) for macOS development signing and the playback runtime.

```sh
cd tauri-app
pnpm --ignore-workspace install --frozen-lockfile
pnpm tauri dev
```

The development app uses a dedicated Tauri data directory. Run `pnpm typecheck` and `pnpm test` for frontend checks.

## Docs

| Topic | Where to look |
| --- | --- |
| First Tauri release | [Release tracker](https://github.com/gaozhangmin/boxplayer/issues/540) |
| Sources and scanning | [Source and scanning integration](docs/subsystems/media-library.md) · [Provider adapters](docs/subsystems/providers.md) |
| Desktop playback | [Playback, native gateway, and subtitles](docs/subsystems/playback.md) |
| Tauri development and debugging | [Desktop development guide](tauri-app/README.md) · [Migration progress](docs/tauri-migration/progress.md) |
| Organizing files from a terminal | [clouddrive-cli](clouddrive-cli/README.en.md) for folder traversal, organization plans, and dry runs |

## Community

[GitHub Issues](https://github.com/gaozhangmin/boxplayer/issues) · [Telegram](https://t.me/+wjdFeQ7ZNNE1NmM1)

When reporting an issue, include the client version, operating system, source type, and steps to reproduce it. For Agent issues, you can also include a screenshot of the plan or receipt with private details removed.

## License and credits

This repository is licensed under the [GPL-3.0](LICENSE). BoxPlayer builds on [aliyunpan](https://github.com/liupan1890/aliyunpan) and integrates [MediaScout](https://github.com/fancydirty/mediary-scout) for media acquisition. See the [third-party notices](tauri-app/THIRD_PARTY_NOTICES.md) for Tauri components. Use media you have the right to access and follow the terms of connected services.
