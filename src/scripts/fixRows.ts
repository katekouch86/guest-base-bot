import { config, requireEnv } from "../config/env";
import { COLUMNS } from "../backup/rows";
import { readRecords, writeRows } from "../google/sheets";
import { stripPhones } from "../utils/phone";

const INFO = COLUMNS.indexOf("Info");

async function main(): Promise<void> {
  requireEnv(["GOOGLE_REFRESH_TOKEN", "GOOGLE_SPREADSHEET_ID"]);

  const rows = (await readRecords(config.googleSpreadsheetId)).map((row) => {
    const full = COLUMNS.map((_, i) => row[i] ?? "");
    full[INFO] = stripPhones(full[INFO]);
    return full;
  });

  await writeRows(config.googleSpreadsheetId, rows);
  console.log(`[${config.backupEnv}] ${rows.length} rows updated.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
