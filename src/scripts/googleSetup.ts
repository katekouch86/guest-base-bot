import { config } from "../config/env";
import { ensureFile, folderUrl, FOLDER_MIME, SPREADSHEET_MIME, spreadsheetUrl } from "../google/drive";
import { setupSpreadsheet } from "../google/sheets";
import { saveToEnv } from "../utils/envFile";

const ROOT_FOLDER = "Y&P Backup";

async function main(): Promise<void> {
  const env = (process.argv[2] || config.backupEnv).toUpperCase();

  const root = await ensureFile(ROOT_FOLDER, FOLDER_MIME);
  const envFolder = await ensureFile(env, FOLDER_MIME, root.id);
  const media = await ensureFile("media", FOLDER_MIME, envFolder.id);
  const spreadsheet = await ensureFile(`Y&P Backup ${env}`, SPREADSHEET_MIME, envFolder.id);

  await setupSpreadsheet(spreadsheet.id, config.timeZone);

  saveToEnv("BACKUP_ENV", env);
  saveToEnv("GOOGLE_SPREADSHEET_ID", spreadsheet.id);
  saveToEnv("GOOGLE_MEDIA_FOLDER_ID", media.id);

  console.log(`Backup "${env}" is ready:`);
  console.log(`  folder:      ${folderUrl(envFolder.id)}`);
  console.log(`  spreadsheet: ${spreadsheetUrl(spreadsheet.id)}`);
  console.log(`  media:       ${folderUrl(media.id)}`);
  console.log("IDs saved to .env");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
