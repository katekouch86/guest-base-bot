import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { config, requireEnv } from "../config/env";
import { BackupPost, buildRows } from "../backup/rows";
import { fileUrl, uploadFile } from "../google/drive";
import { appendRows, listMessageKeys } from "../google/sheets";
import { extractPhones } from "../utils/phone";

const args = process.argv.slice(2);
const argValue = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const EXPORT_DIR = process.env.EXPORT_DIR || "export";
const MAIN_DIR = argValue("--dir") ?? join(EXPORT_DIR, "main");
const GIFS_DIR = argValue("--dir") ? "" : join(EXPORT_DIR, "gifs");
const CHAT_USERNAME = process.env.EXPORT_CHAT_USERNAME || "amagagr";
const POSTS_PER_BATCH = 20;
const UPLOAD_CONCURRENCY = 6;

const LIMIT = Number(argValue("--limit") ?? Infinity);
const DRY_RUN = args.includes("--dry-run");

interface ExportMessage {
  id: number;
  type: string;
  date_unixtime: string;
  from?: string | null;
  from_id?: string;
  text: string | (string | { text: string })[];
  photo?: string;
  file?: string;
  media_type?: string;
  mime_type?: string;
}

interface ExportFile {
  messageId: number;
  index: number;
  path: string | null;
  name: string;
  mimeType: string;
}

interface ExportPost {
  messages: ExportMessage[];
  text: string;
  files: ExportFile[];
}

const NOT_INCLUDED = "(File not included";

function readExport(dir: string): { id: number; messages: ExportMessage[] } {
  return JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
}

const messageText = (m: ExportMessage) =>
  typeof m.text === "string" ? m.text : m.text.map((t) => (typeof t === "string" ? t : t.text)).join("");

const hasMedia = (m: ExportMessage) => Boolean(m.photo || m.file);

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

// Albums aren't marked in the export: a media message without text, sent by the same author
// within a second of the previous media message, belongs to the previous post.
function groupPosts(messages: ExportMessage[]): ExportMessage[][] {
  const posts: ExportMessage[][] = [];

  for (const m of messages.filter((m) => m.type === "message")) {
    const previous = posts.at(-1)?.at(-1);
    const albumPart =
      previous &&
      hasMedia(m) &&
      hasMedia(previous) &&
      !messageText(m).trim() &&
      m.from_id === previous.from_id &&
      Number(m.date_unixtime) - Number(previous.date_unixtime) <= 1;

    if (albumPart) posts.at(-1)!.push(m);
    else posts.push([m]);
  }
  return posts;
}

function loadPosts(): { chatId: number; posts: ExportPost[] } {
  const main = readExport(MAIN_DIR);
  const gifs = GIFS_DIR && existsSync(join(GIFS_DIR, "result.json")) ? readExport(GIFS_DIR) : null;
  const gifFiles = new Map(
    (gifs?.messages ?? [])
      .filter((m) => m.media_type === "animation" && m.file && !m.file.startsWith(NOT_INCLUDED))
      .map((m) => [m.id, m.file!]),
  );

  const resolveFile = (m: ExportMessage, index: number): ExportFile => {
    let relative = m.photo ?? m.file!;
    let dir = MAIN_DIR;
    if (relative.startsWith(NOT_INCLUDED) && gifFiles.has(m.id)) {
      relative = gifFiles.get(m.id)!;
      dir = GIFS_DIR;
    }

    const missing = relative.startsWith(NOT_INCLUDED);
    const ext = missing ? "" : extname(relative).toLowerCase();
    const date = new Date(Number(m.date_unixtime) * 1000).toISOString().slice(0, 10);
    return {
      messageId: m.id,
      index,
      path: missing ? null : join(dir, relative),
      name: `${date}_${m.id}${index ? `_${index + 1}` : ""}${ext}`,
      mimeType: m.mime_type || MIME_BY_EXT[ext] || "application/octet-stream",
    };
  };

  const posts = groupPosts(main.messages).map((messages) => ({
    messages,
    text: messages.map(messageText).filter((t) => t.trim()).join("\n"),
    files: messages.filter(hasMedia).map((m, i) => resolveFile(m, i)),
  }));

  const relevant = posts.filter((p) => p.files.length > 0 || extractPhones(p.text).length > 0);
  return { chatId: Number(`-100${main.id}`), posts: relevant };
}

const STATE_FILE = `.import-state-${config.backupEnv.toLowerCase()}.json`;

interface UploadState {
  spreadsheetId: string;
  files: Record<string, string>;
}

function loadState(): UploadState {
  if (existsSync(STATE_FILE)) {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as UploadState;
    if (state.spreadsheetId === config.googleSpreadsheetId) return state;
  }
  return { spreadsheetId: config.googleSpreadsheetId, files: {} };
}

const saveState = (state: UploadState) => writeFileSync(STATE_FILE, JSON.stringify(state));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status: number | undefined = err?.response?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt >= 6) throw err;
      const wait = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
      console.warn(`  ${label} failed (${status ?? err?.code ?? err?.message}), retry ${attempt} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  requireEnv(["GOOGLE_REFRESH_TOKEN", "GOOGLE_SPREADSHEET_ID", "GOOGLE_MEDIA_FOLDER_ID"]);

  const { chatId, posts } = loadPosts();
  const done = DRY_RUN ? new Set<string>() : await listMessageKeys(config.googleSpreadsheetId);
  const keyOf = (p: ExportPost) => `${chatId}:${p.messages[0].id}`;

  const todo = posts.filter((p) => !done.has(keyOf(p))).slice(0, LIMIT);
  const totalFiles = todo.reduce((n, p) => n + p.files.length, 0);
  console.log(
    `[${config.backupEnv}] posts in export: ${posts.length}, already imported: ${posts.length - posts.filter((p) => !done.has(keyOf(p))).length}, ` +
      `to import now: ${todo.length} (${totalFiles} files)${DRY_RUN ? " — DRY RUN" : ""}`,
  );

  const state = loadState();
  const problems: string[] = [];
  let rowsWritten = 0;
  let filesDone = 0;
  const started = Date.now();

  for (let start = 0; start < todo.length; start += POSTS_PER_BATCH) {
    const batch = todo.slice(start, start + POSTS_PER_BATCH);
    const rows: string[][] = [];

    const uploadOne = async (file: ExportFile): Promise<string> => {
      if (!file.path || !existsSync(file.path)) {
        problems.push(`message ${file.messageId}: file is missing in the export`);
        return "⚠️ file not saved (missing in Telegram export)";
      }
      if (DRY_RUN) return `(dry run) ${file.name}`;

      const stateKey = `${file.messageId}:${file.index}`;
      state.files[stateKey] ??= await withRetry(`upload ${file.name}`, () =>
        uploadFile({ name: file.name, mimeType: file.mimeType, parentId: config.googleMediaFolderId, path: file.path! }),
      );
      saveState(state);
      filesDone++;
      return fileUrl(state.files[stateKey]);
    };

    const links = await mapLimit(batch.flatMap((p) => p.files), UPLOAD_CONCURRENCY, uploadOne);
    let linkIndex = 0;

    for (const post of batch) {
      const first = post.messages[0];
      const media = links.slice(linkIndex, linkIndex + post.files.length);
      linkIndex += post.files.length;

      const backupPost: BackupPost = {
        messageKey: keyOf(post),
        text: post.text,
        date: new Date(Number(first.date_unixtime) * 1000),
        author: first.from ?? "",
        postLink: `https://t.me/${CHAT_USERNAME}/${first.id}`,
        media,
        source: "import",
      };
      rows.push(...buildRows(backupPost, config.timeZone));
    }

    if (DRY_RUN) {
      for (const row of rows.slice(0, 5)) console.log(row.map((c) => c.replace(/\n/g, " | ")).join("  ‖  "));
    } else {
      await withRetry("append rows", () => appendRows(config.googleSpreadsheetId, rows));
    }
    rowsWritten += rows.length;

    const posted = Math.min(start + POSTS_PER_BATCH, todo.length);
    const minutes = (Date.now() - started) / 60_000;
    const eta = posted < todo.length ? `, ~${Math.ceil((minutes / posted) * (todo.length - posted))} min left` : "";
    console.log(`  ${posted}/${todo.length} posts, ${rowsWritten} rows, ${filesDone}/${totalFiles} files${eta}`);
  }

  console.log(`\nDone in ${((Date.now() - started) / 60_000).toFixed(1)} min: ${todo.length} posts -> ${rowsWritten} rows.`);
  if (problems.length > 0) console.log(`Problems (${problems.length}):\n  ${problems.join("\n  ")}`);
}

main().catch((err) => {
  console.error("\nImport stopped:", err instanceof Error ? err.message : err);
  console.error("Run the same command again to continue from where it stopped.");
  process.exit(1);
});
