"""Send published release notes to the configured Telegram chat without exposing secrets."""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat:
        raise RuntimeError("Telegram release secrets are missing")
    tag = os.environ.get("RELEASE_TAG", "")
    if tag:
        url = os.environ["GITHUB_API_URL"] + "/repos/" + os.environ["GITHUB_REPOSITORY"] + "/releases/tags/" + urllib.parse.quote(tag, safe="")
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            release = json.load(response)
    else:
        with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as event_file:
            release = json.load(event_file).get("release")
    if not release or release.get("draft"):
        raise RuntimeError("Only published releases can be announced")
    notes = (release.get("body") or "").strip()
    notes = re.sub(r"https://github\.com/[^\s)<>]+/(?:releases/download|releases/tag)/[^\s)<>]+", "https://boxplayer.cc/download/", notes)
    notes = re.sub(r"<!--.*?-->", "", notes, flags=re.S).strip()
    links = "下载 / Downloads: https://boxplayer.cc/download/"
    if os.environ.get("TELEGRAM_APPLE") == "1":
        links += "\nTestFlight: https://testflight.apple.com/join/WBY9FRZy"
    title = release.get("name") or "BoxPlayer " + release["tag_name"]
    # One bounded message avoids partial multi-message delivery on retries.
    budget = 3900 - len(title) - len(links)
    if len(notes) > budget:
        notes = notes[:budget] + "\n…"
    payload = {"chat_id": chat, "text": title + "\n\n" + notes + "\n\n" + links,
               "link_preview_options": {"is_disabled": True}}
    request = urllib.request.Request("https://api.telegram.org/bot" + token + "/sendMessage",
        data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if not result.get("ok"):
        raise RuntimeError("Telegram did not accept the announcement")
    print("Telegram release announcement sent successfully")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        print("Release notification failed (HTTP %s)" % error.code, file=sys.stderr)
        sys.exit(1)
    except Exception:
        # urllib exception strings can include the Bot Token in their URL.
        print("Release notification failed; check secrets, chat access and release tag", file=sys.stderr)
        sys.exit(1)
