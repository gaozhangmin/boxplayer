# BoxPlayer Playwright tests

## Full local test suite

```bash
pnpm run test:e2e
```

This builds the production renderer, runs the isolated packaged-renderer checks, and then runs the real cloud-account tests. Real-cloud cases automatically clone the local BoxPlayer profile into a temporary directory; they are not conditionally skipped. No frontend dev server is required.

## Packaged-renderer tests without a real account

```bash
pnpm run test:e2e:isolated
```

This is the CI-safe subset. It checks packaged CSS and assets, console/resource errors, core workspace navigation, and settings persistence using a temporary empty profile. GitHub Actions uses this command because the local cloud account profile is never uploaded to CI.

## Real cloud smoke tests

```bash
pnpm run test:e2e:real
```

The real suite copies the local BoxPlayer profile into a temporary directory automatically, runs serially, and never writes to the original application profile. It currently verifies:

- a signed-in cloud account can load its root directory;
- 123 Cloud global search can find the isolated E2E folder;
- 123 Cloud pagination appends cursor pages on scroll (the test rewrites only the request page size to 10);
- a tiny media file can be uploaded to `BoxPlayer-E2E`, scraped into the cloned media database, and moved to cloud trash afterward;
- a desktop drag-and-drop upload reaches the selected `BoxPlayer-E2E` folder and is moved to cloud trash afterward;
- an uploaded file can be renamed, observed under its new name after refresh, and moved to cloud trash afterward;
- the move destination picker can expand an existing child folder, move an uploaded file into it, and clean up both the file and folder afterward;
- the copy destination picker can create a child folder, copy an uploaded file into it, and clean up both the copy and folder afterward;
- an existing cloud video resolves a real provider playback URL and opens in the configured web or native MPV player.

Optional overrides:

```bash
BOXPLAYER_E2E_REAL_USER_DATA=/path/to/BoxPlayer/profile pnpm run test:e2e:real
BOXPLAYER_E2E_PAGINATION_FOLDER='行尸走肉/S10' pnpm run test:e2e:real
```

Real tests require explicit approval because they connect to real accounts. Write operations stay inside the dedicated `BoxPlayer-E2E` folder, and test files are moved to trash after verification, including best-effort cleanup after a failed assertion. Playback fails with the provider response when URL generation is rejected because of an account quota or another provider-side restriction; it is never reported as skipped or successful.

The isolated production-renderer suite also checks that application settings survive a renderer reload without using the real profile.
