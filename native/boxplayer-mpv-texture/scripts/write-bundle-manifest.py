#!/usr/bin/env python3
import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def command_output(args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ""


def main() -> int:
    if len(sys.argv) != 5:
        print("usage: write-bundle-manifest.py <bundle-dir> <manifest-path> <arch> <libmpv-source>", file=sys.stderr)
        return 2

    bundle_dir, manifest_path, arch, libmpv_source = sys.argv[1:]
    files = []
    for name in sorted(os.listdir(bundle_dir)):
        path = os.path.join(bundle_dir, name)
        if not os.path.isfile(path):
            continue
        if name == os.path.basename(manifest_path):
            continue
        files.append(
            {
                "name": name,
                "bytes": os.path.getsize(path),
                "sha256": sha256(path),
            }
        )

    manifest = {
        "name": "boxplayer-macos-embedded-mpv-bundle",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "platform": "darwin",
        "arch": arch,
        "source": {
            "libmpv": os.path.realpath(libmpv_source),
            "homebrewPrefix": command_output(["brew", "--prefix"]),
            "mpvVersion": command_output(["mpv", "--version"]).splitlines()[0] if command_output(["mpv", "--version"]) else "",
            "macos": platform.mac_ver()[0],
        },
        "runtimePath": f"engine/darwin/{arch}/mpv-texture/boxplayer-mpv-texture.node",
        "files": files,
    }

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
