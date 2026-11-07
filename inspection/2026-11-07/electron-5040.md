# Electron 5.0.40 release inspection

User authorized merge of v5.0.39, startup-password UI repair, #535 repair and new Electron release with final main synchronization.

- All open GitHub issues paginated: #535 (missing packaged download dependencies), #534 (Windows cloud mounting and write operations). Comments read; #534 remains open as a separate feature request, no new claims of delivery.
- #535: aria2-lib and @motrix/nat-api were externalized but dev-only. Moved to production dependencies with matching lockfile, added afterPack ASAR entry/transitive dependency verification. Actual macOS arm64 package passes (30 dependency packages); both runtime modules load using packaged Electron.
- Startup PIN UI: themed Arco password controls, labels, consistent actions, invalid/mismatched save disabled. Existing lock policy unchanged.
- Merged v5.0.39 release commits, retained registry.ensureLoaded(), search HTTP Electron regression passed.
- Validation: 35 focused unit tests passed; vue-tsc passed after correcting DOM refs to shallowRef. Production Vite build passed. Password settings and HTTP streaming Electron regressions passed (2/2). Local unsigned macOS arm64 package tested with native Electron runtime. Linux/Windows/Intel macOS acceptance requires release CI; not inferred from macOS.
- Android phone/tablet/TV and Apple iOS/iPadOS/macOS/tvOS native clients use different packaging/UI. This issue and release target Electron only; no native-client changes or release claims. Tauri remains in its separate worktree and is excluded.
- Publication pending CI. Do not close #535 or claim public delivery until installation assets and update feeds are verified. Website changelog pending actual publication.
