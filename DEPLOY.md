# Deploy to Railway

The bot uses long polling, so it needs no domain or port — just a running service.

## 1. Create the service

In the Railway project (the same one as the rating bot): **New → GitHub Repo** (or `railway up` from this folder).
Railway detects Node.js and runs `npm run build` and `npm start` from `package.json`.

## 2. Variables

Service → **Variables → Raw Editor**, paste and fill in:

```
BOT_TOKEN=
SOURCE_CHAT_IDS=-1002034083555
ADMIN_IDS=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_SPREADSHEET_ID=
GOOGLE_MEDIA_FOLDER_ID=
BACKUP_ENV=PROD
TIME_ZONE=Europe/Rome
NODE_ENV=production
```

| Variable                                  | Where to get it                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `BOT_TOKEN`                               | @BotFather → the production bot (@GuestbaseBot)                                 |
| `ADMIN_IDS`                               | Telegram user IDs for error notifications (@userinfobot shows yours)            |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `google-oauth-client.json` (Google Cloud project `yp-backup-bot`, Desktop client) |
| `GOOGLE_REFRESH_TOKEN`                    | `npm run google:auth` locally, then copy from `.env`                            |
| `GOOGLE_SPREADSHEET_ID`, `GOOGLE_MEDIA_FOLDER_ID` | `npm run google:setup -- PROD` locally, then copy from `.env`           |

Locally all these values are already in `.env`.

## 3. Check

Deploy logs should show:

```
Bot starting... backing up -1002034083555 to Google (PROD)
```

Post a photo with a phone number in the group (or wait for a new post) — a row appears in **Records** within seconds:

```
[saved] chat -1002034083555, message 3200 -> 1 row(s), phones: +39..., media: 1
```

## Notes

- Only **one** running copy per bot token: stop the bot locally before starting it on Railway,
  otherwise Telegram returns `409 Conflict`.
- The Google OAuth app must stay **In production** (Google Cloud → Google Auth Platform → Audience),
  in "Testing" the refresh token expires after 7 days.
- If Google access is revoked, run `npm run google:auth` again and update `GOOGLE_REFRESH_TOKEN` on Railway.
