# Y&P Backup Bot

Telegram bot that backs up the client group «БАЗА Г.» to Google: photos and videos go to Google Drive,
phone numbers and comments go to a Google Sheets table with a search sheet.

- One row per phone number. Posts with a list of numbers are split, the header ("Проверен ок 👍🏻")
  goes to every number, the comment stays with its number. The full post is kept in "Full post".
- Albums (several photos) stay in one row: Media 1–4.
- Phone numbers are normalized to `+393343039932`, Info keeps only the comment.
- Posts deleted in Telegram stay in the table (it's a backup).
- Duplicates are skipped by `Message ID` (`<chat id>:<message id>`), so the bot and the import never write a post twice.

## Google Drive structure

```
Y&P Backup/
└── PROD/
    ├── Y&P Backup PROD   ← spreadsheet: "Search" and "Records" sheets
    └── media/            ← photos and videos
```

**Search** sheet: type a phone number (full or partial, with or without spaces), a name, a date or any word
into the yellow box. Matching rows appear below with clickable links to files and posts.

**Records** sheet: the data itself. Don't edit or delete the `Message ID` column, the bot relies on it.

## Scripts

| Command                         | What it does                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                   | Run the bot locally with auto-reload                                         |
| `npm run build` / `npm start`   | Build and run (Railway)                                                      |
| `npm run google:auth`           | One-time Google login, saves `GOOGLE_REFRESH_TOKEN` to `.env`                |
| `npm run google:setup [-- ENV]` | Creates/updates the Drive folders and the spreadsheet, saves their IDs to `.env` |
| `npm run import`                | Imports a Telegram Desktop export (see below). Safe to stop and run again    |
| `npm run fix:rows`              | Rewrites existing rows in the current format (Info without numbers, clickable links) |

## Importing history

Telegram bots can't read old messages, so history comes from a Telegram Desktop export
(group → ⋮ → Export chat history, format JSON):

- `export/main/` — export with Photos and Videos
- `export/gifs/` — optional second export with GIFs only (short videos without sound)

```bash
npm run import -- --dry-run --limit 20   # preview, writes nothing
npm run import                           # import everything that isn't in the table yet
npm run import -- --dir export/update    # a single later export (photos, videos and GIFs together)
```

Posts already in the table are skipped, uploaded files are remembered in `.import-state-<env>.json`,
so an interrupted import continues where it stopped.

## Telegram setup

Add the bot to the group and disable privacy mode in @BotFather
(Bot Settings → Group Privacy → Turn off), otherwise it only sees commands.
The bot logs the chat ID of every message it ignores — use it for `SOURCE_CHAT_IDS`.

## Limits

- Bots can download files up to 20 MB. Bigger videos get a "⚠️ file not saved" note and an admin notification.
- Google Drive: 15 GB on the free account (the history takes ~0.75 GB).

Deployment: see [DEPLOY.md](DEPLOY.md).
