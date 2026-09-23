# Real cloud release gate

The release workflow can inject dedicated BoxPlayer test accounts into a temporary Electron profile and verify every supported cloud provider through the production application and embedded MPV.

## Providers required by the release gate

`aliyun`, `cloud123`, `115`, `baidu`, `pikpak`, `quark`, `139`, `189`, `guangya`, `dropbox`, `onedrive`, `box`, and `google`.

Use dedicated test accounts. Do not use a personal account containing private files.

## Prepare each account

1. Sign in to every provider in BoxPlayer.
2. Create `BoxPlayer-E2E` in each provider root.
3. Upload the same small seekable MP4 as `boxplayer-e2e.mp4`. A 20–60 second H.264/AAC file is sufficient.
4. In BoxPlayer, open Settings → Account and run **Export CLI tokens**. This writes `~/.clouddrive-cli/tokens.json` with mode `0600` on supported filesystems.
5. Confirm the export locally without printing credentials:

   ```bash
   BOXPLAYER_E2E_ACCOUNTS_JSON="$(<~/.clouddrive-cli/tokens.json)" node scripts/real-cloud-e2e-config.cjs
   ```

The preflight prints provider names only. It never prints tokens or cookies.

## Store credentials in GitHub

Add encrypted repository Actions secrets. The real-account steps are disabled for ordinary branch pushes and enabled by the release caller. Use a separate login session/export for every platform, because some providers rotate refresh tokens. Set each secret from standard input so the value is not placed in shell history:

```bash
gh secret set BOXPLAYER_E2E_ACCOUNTS_LINUX_X64_JSON < /secure/path/tokens-linux-x64.json
gh secret set BOXPLAYER_E2E_ACCOUNTS_LINUX_ARM64_JSON < /secure/path/tokens-linux-arm64.json
gh secret set BOXPLAYER_E2E_ACCOUNTS_WINDOWS_X64_JSON < /secure/path/tokens-windows-x64.json
gh secret set BOXPLAYER_E2E_ACCOUNTS_MACOS_ARM64_JSON < /secure/path/tokens-macos-arm64.json
```

`BOXPLAYER_E2E_ACCOUNTS_JSON` remains a supported common fallback for initial setup, but it is less reliable for rotating OAuth credentials. Platform-specific secrets take precedence. Release jobs run serially as an additional safeguard.

If every provider uses the default test path and name, no additional configuration is needed. Optional repository variables:

```text
BOXPLAYER_E2E_MEDIA_FOLDER=BoxPlayer-E2E
BOXPLAYER_E2E_MEDIA_FILE=boxplayer-e2e.mp4
```

For provider-specific paths, add the encrypted `BOXPLAYER_E2E_TARGETS_JSON` secret:

```json
{
  "aliyun": { "path": ["BoxPlayer-E2E"], "fileName": "boxplayer-e2e.mp4" },
  "quark": { "path": ["Automated Tests", "Playback"], "fileName": "sample.mp4" }
}
```

Every required provider must have exactly one imported account and one playback target. Missing configuration fails the release instead of skipping the test.

## What the gate verifies on Linux x64/arm64, Windows x64, and macOS arm64

- imports the account into a newly created temporary profile;
- refreshes or validates the provider session through BoxPlayer's production code;
- switches to the provider and loads its real root directory;
- traverses the configured test folder using the provider list API;
- opens the real media file and resolves its download URL through `ApiFileDownloadUrl`;
- preserves provider-specific Cookie, Authorization, User-Agent, Referer, Origin, and `x-urlp` headers;
- starts embedded MPV, waits for duration and playback progress, pauses, seeks, resumes, and checks for player errors;
- deletes the temporary Electron profile after the test.

Quark and some session-based providers cannot refresh indefinitely. Rotate the dedicated test credential when the release gate reports an expired session.

Never upload `tokens.json` as an Actions artifact or commit it to Git.
