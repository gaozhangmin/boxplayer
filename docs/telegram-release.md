# Telegram release notifications

Repository Actions secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
The bot must be a member of the target chat and have permission to send messages.
Published releases use the same notification entry points as Discord, including explicit calls for GITHUB_TOKEN-created releases.
Downloads point to https://boxplayer.cc/download/; Apple also includes https://testflight.apple.com/join/WBY9FRZy.
No notification is sent for an App Store review submission; Apple availability is checked by the existing sync workflow.
Network failures fail the notification step. Check the group before retrying an ambiguous delivery.
