import dotenv from "dotenv";

dotenv.config({ quiet: true });

const list = (value?: string) =>
  (value || "").split(",").map((item) => item.trim()).filter(Boolean);

export const config = {
  botToken: process.env.BOT_TOKEN!,
  sourceChatIds: list(process.env.SOURCE_CHAT_IDS),
  backupEnv: (process.env.BACKUP_ENV || "TEST").toUpperCase(),
  googleSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID!,
  googleMediaFolderId: process.env.GOOGLE_MEDIA_FOLDER_ID!,
  timeZone: process.env.TIME_ZONE || "Europe/Rome",
  adminIds: list(process.env.ADMIN_IDS),
  nodeEnv: process.env.NODE_ENV || "development",
};

export function requireEnv(keys: readonly string[]): void {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}
