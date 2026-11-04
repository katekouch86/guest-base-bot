import { sheets, sheets_v4 } from "@googleapis/sheets";
import { COLUMNS, MESSAGE_ID_COLUMN } from "../backup/rows";
import { getGoogleAuth } from "./auth";

export const RECORDS_SHEET = "Records";
export const SEARCH_SHEET = "Search";

let client: sheets_v4.Sheets | null = null;

function getSheets(): sheets_v4.Sheets {
  client ??= sheets({ version: "v4", auth: getGoogleAuth() });
  return client;
}

const columnLetter = (index: number) => String.fromCharCode(65 + index);
const LAST_COLUMN = columnLetter(COLUMNS.length - 1);
const MESSAGE_ID_LETTER = columnLetter(MESSAGE_ID_COLUMN);
const SEARCH_LAST_COLUMN = columnLetter(COLUMNS.indexOf("Post link"));

// Whole-column references: appending rows shifts ranges like A2:A, but never A:A.
const col = (name: (typeof COLUMNS)[number]) => `${RECORDS_SHEET}!${columnLetter(COLUMNS.indexOf(name))}:${columnLetter(COLUMNS.indexOf(name))}`;
const MESSAGE_IDS = `${RECORDS_SHEET}!${MESSAGE_ID_LETTER}:${MESSAGE_ID_LETTER}`;

// Sheets turns "+39 338..." typed into the box into the formula "=39 338...", so the formula text is used as the query.
const SEARCH_FORMULA = `=ARRAYFORMULA(LET(
  q, TRIM(IF(ISFORMULA(B1), REGEXREPLACE(FORMULATEXT(B1), "^=\\+?", ""), B1 & "")),
  d, REGEXREPLACE(q, "\\D", ""),
  phoneHit, IF(LEN(d) >= 4, ISNUMBER(SEARCH(d, REGEXREPLACE(${col("Phone")} & "", "\\D", ""))), FALSE),
  textHit, ISNUMBER(SEARCH(q, ${col("Info")} & " " & ${col("Date")} & " " & ${col("Author")} & " " & ${col("Full post")})),
  found, IFERROR(FILTER(${RECORDS_SHEET}!A:${SEARCH_LAST_COLUMN}, (phoneHit + textHit) * (${MESSAGE_IDS} <> "") * (ROW(${MESSAGE_IDS}) > 1)), "Nothing found"),
  IF(q = "", "",
    IF(LEFT(found, 13) = "https://t.me/", HYPERLINK(found, "✈️ Telegram"),
      IF(LEFT(found, 8) = "https://", HYPERLINK(found, "📎 File"), found)))
))`;

const PROTECTION_NOTE = "Y&P backup: managed by the bot";

const LINK_COLUMNS = COLUMNS.flatMap((name, i) => (name.startsWith("Media") || name === "Post link" ? [i] : []));

function toCell(value: string): sheets_v4.Schema$CellData {
  const cell: sheets_v4.Schema$CellData = { userEnteredValue: { stringValue: value } };
  if (/^https:\/\/\S+$/.test(value)) cell.userEnteredFormat = { textFormat: { link: { uri: value } } };
  return cell;
}

const toRowData = (rows: string[][]): sheets_v4.Schema$RowData[] => rows.map((row) => ({ values: row.map(toCell) }));
const CELL_FIELDS = "userEnteredValue,userEnteredFormat.textFormat.link";

const sheetIds = new Map<string, number>();

async function getRecordsSheetId(spreadsheetId: string): Promise<number> {
  if (!sheetIds.has(spreadsheetId)) {
    const { data } = await getSheets().spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" });
    const sheet = data.sheets!.find((s) => s.properties!.title === RECORDS_SHEET)!;
    sheetIds.set(spreadsheetId, sheet.properties!.sheetId!);
  }
  return sheetIds.get(spreadsheetId)!;
}

const COLUMN_WIDTHS: Partial<Record<(typeof COLUMNS)[number], number>> = {
  Phone: 140,
  Info: 360,
  Date: 130,
  Author: 120,
  "Full post": 360,
  "Post link": 220,
  "Message ID": 190,
  Source: 70,
};

export async function setupSpreadsheet(spreadsheetId: string, timeZone: string): Promise<void> {
  const api = getSheets();
  const { data } = await api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const existing = data.sheets!.map((s) => s.properties!);

  const records = existing.find((s) => s.title === RECORDS_SHEET) ?? existing[0];
  const search = existing.find((s) => s.title === SEARCH_SHEET);

  const requests: sheets_v4.Schema$Request[] = [
    // English locale so formulas use "," separators regardless of the account language.
    { updateSpreadsheetProperties: { properties: { locale: "en_US", timeZone }, fields: "locale,timeZone" } },
    {
      updateSheetProperties: {
        properties: { sheetId: records.sheetId, title: RECORDS_SHEET, index: 1, gridProperties: { frozenRowCount: 1 } },
        fields: "title,index,gridProperties.frozenRowCount",
      },
    },
  ];
  if (!search) {
    requests.push({
      addSheet: { properties: { title: SEARCH_SHEET, index: 0, gridProperties: { frozenRowCount: 3 } } },
    });
  }
  const added = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  const searchId = search?.sheetId ?? added.data.replies!.find((r) => r.addSheet)!.addSheet!.properties!.sheetId!;

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `${RECORDS_SHEET}!A1:${LAST_COLUMN}1`, values: [[...COLUMNS]] },
        { range: `${SEARCH_SHEET}!A1`, values: [["🔍 Search: phone, name, date or any text →"]] },
        { range: `${SEARCH_SHEET}!A2`, values: [["Type only in the yellow box. Results appear below."]] },
        { range: `${SEARCH_SHEET}!A3`, values: [[`={${RECORDS_SHEET}!A1:${SEARCH_LAST_COLUMN}1}`]] },
        { range: `${SEARCH_SHEET}!A4`, values: [[SEARCH_FORMULA]] },
      ],
    },
  });

  const bold = { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } } };
  const textCell = { userEnteredFormat: { numberFormat: { type: "TEXT" } } };
  const wrap = { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } };

  const plain = { userEnteredFormat: { textFormat: { bold: false }, backgroundColor: { red: 1, green: 1, blue: 1 } } };

  const format: sheets_v4.Schema$Request[] = [
    { repeatCell: { range: { sheetId: records.sheetId, startRowIndex: 1 }, cell: plain, fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor" } },
    { repeatCell: { range: { sheetId: searchId, startRowIndex: 3 }, cell: plain, fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor" } },
    { repeatCell: { range: { sheetId: records.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: bold, fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor" } },
    { repeatCell: { range: { sheetId: searchId, startRowIndex: 2, endRowIndex: 3 }, cell: bold, fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor" } },
    { repeatCell: { range: { sheetId: records.sheetId, startRowIndex: 1 }, cell: wrap, fields: "userEnteredFormat(wrapStrategy,verticalAlignment)" } },
    { repeatCell: { range: { sheetId: searchId, startRowIndex: 3 }, cell: wrap, fields: "userEnteredFormat(wrapStrategy,verticalAlignment)" } },
    ...LINK_COLUMNS.map((index) => ({
      repeatCell: {
        range: { sheetId: records.sheetId, startRowIndex: 1, startColumnIndex: index, endColumnIndex: index + 1 },
        cell: { userEnteredFormat: { wrapStrategy: "CLIP" } },
        fields: "userEnteredFormat.wrapStrategy",
      },
    })),
    {
      repeatCell: {
        range: { sheetId: searchId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            ...textCell.userEnteredFormat,
            backgroundColor: { red: 1, green: 0.95, blue: 0.6 },
            textFormat: { bold: true, fontSize: 12 },
          },
        },
        fields: "userEnteredFormat(numberFormat,backgroundColor,textFormat)",
      },
    },
    {
      mergeCells: {
        range: { sheetId: searchId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 3 },
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: { sheetId: searchId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
    {
      repeatCell: {
        range: { sheetId: searchId, startRowIndex: 1, endRowIndex: 2 },
        cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColor: { red: 0.45, green: 0.45, blue: 0.45 } } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
  ];

  const { data: protection } = await api.spreadsheets.get({ spreadsheetId, fields: "sheets(properties.sheetId,protectedRanges(description))" });
  const isProtected = (sheetId: number | null | undefined) =>
    protection.sheets!.some((s) => s.properties!.sheetId === sheetId && s.protectedRanges?.some((r) => r.description === PROTECTION_NOTE));

  // Warning only: people can still edit after confirming, the bot writes through the API as the owner.
  if (!isProtected(searchId)) {
    format.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: searchId },
          unprotectedRanges: [{ sheetId: searchId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 3 }],
          description: PROTECTION_NOTE,
          warningOnly: true,
        },
      },
    });
  }
  if (!isProtected(records.sheetId)) {
    for (const range of [
      { sheetId: records.sheetId, startRowIndex: 0, endRowIndex: 1 },
      { sheetId: records.sheetId, startColumnIndex: MESSAGE_ID_COLUMN, endColumnIndex: MESSAGE_ID_COLUMN + 1 },
    ]) {
      format.push({ addProtectedRange: { protectedRange: { range, description: PROTECTION_NOTE, warningOnly: true } } });
    }
  }

  for (const [name, width] of Object.entries(COLUMN_WIDTHS)) {
    const index = COLUMNS.indexOf(name as (typeof COLUMNS)[number]);
    for (const sheetId of [records.sheetId, searchId]) {
      if (sheetId === searchId && index > COLUMNS.indexOf("Post link")) continue;
      format.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
          properties: { pixelSize: width },
          fields: "pixelSize",
        },
      });
    }
  }

  await api.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: [`${SEARCH_SHEET}!B1:C1`, `${SEARCH_SHEET}!B2:Z2`] } });
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ unmergeCells: { range: { sheetId: searchId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 3 } } }] } });
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: format } });
}

export async function appendRows(spreadsheetId: string, rows: string[][]): Promise<void> {
  if (rows.length === 0) return;
  const sheetId = await getRecordsSheetId(spreadsheetId);
  await getSheets().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ appendCells: { sheetId, rows: toRowData(rows), fields: CELL_FIELDS } }] },
  });
}

export async function writeRows(spreadsheetId: string, rows: string[][], chunkSize = 500): Promise<void> {
  const sheetId = await getRecordsSheetId(spreadsheetId);
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    await getSheets().spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateCells: {
              start: { sheetId, rowIndex: start + 1, columnIndex: 0 },
              rows: toRowData(chunk),
              fields: CELL_FIELDS,
            },
          },
        ],
      },
    });
  }
}

export async function listMessageKeys(spreadsheetId: string): Promise<Set<string>> {
  const { data } = await getSheets().spreadsheets.values.get({
    spreadsheetId,
    range: `${RECORDS_SHEET}!${MESSAGE_ID_LETTER}2:${MESSAGE_ID_LETTER}`,
  });
  return new Set((data.values ?? []).map((row) => String(row[0] ?? "")).filter(Boolean));
}

export async function readRecords(spreadsheetId: string): Promise<string[][]> {
  const { data } = await getSheets().spreadsheets.values.get({
    spreadsheetId,
    range: `${RECORDS_SHEET}!A2:${LAST_COLUMN}`,
  });
  return (data.values ?? []) as string[][];
}
