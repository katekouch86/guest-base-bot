import { extname } from "node:path";
import type { Api } from "grammy";
import type { Chat, Message } from "grammy/types";
import { config } from "../config/env";
import { BackupPost, buildRows } from "../backup/rows";
import { fileUrl, uploadFile } from "../google/drive";
import { appendRows, listMessageKeys } from "../google/sheets";
import { extractPhones } from "../utils/phone";

const MAX_TELEGRAM_DOWNLOAD_BYTES = 20 * 1024 * 1024;

interface MediaItem {
  messageId: number;
  fileId: string;
  fileSize?: number;
  extension: string;
  mimeType: string;
}

export function getMessageKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export function getPostLink(chat: Chat, messageId: number): string {
  if ("username" in chat && chat.username) return `https://t.me/${chat.username}/${messageId}`;

  const internalId = String(chat.id).replace(/^-100/, "");
  return `https://t.me/c/${internalId}/${messageId}`;
}

function getAuthor(message: Message): string {
  if (message.author_signature) return message.author_signature;
  if (message.sender_chat && "title" in message.sender_chat) return message.sender_chat.title ?? "";
  if (message.from) return [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");
  return "";
}

function getMedia(message: Message): MediaItem | null {
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return { messageId: message.message_id, fileId: largest.file_id, fileSize: largest.file_size, extension: ".jpg", mimeType: "image/jpeg" };
  }

  const video = message.video ?? message.animation;
  if (video) {
    const extension = extname(video.file_name ?? "").toLowerCase() || ".mp4";
    return { messageId: message.message_id, fileId: video.file_id, fileSize: video.file_size, extension, mimeType: video.mime_type || "video/mp4" };
  }

  return null;
}

async function downloadFile(api: Api, fileId: string): Promise<Buffer> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error(`Telegram returned no file_path for ${fileId}`);

  const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
  if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let savedKeys: Set<string> | null = null;

async function isSaved(key: string): Promise<boolean> {
  savedKeys ??= await listMessageKeys(config.googleSpreadsheetId);
  return savedKeys.has(key);
}

export type SaveResult =
  | { status: "saved"; rows: number; phones: string[]; media: number; errors: string[] }
  | { status: "duplicate" | "skipped" };

export async function savePost(api: Api, messages: Message[]): Promise<SaveResult> {
  const first = messages[0];
  const key = getMessageKey(first.chat.id, first.message_id);

  const text = messages
    .map((m) => m.caption ?? m.text)
    .filter(Boolean)
    .join("\n");
  const phones = extractPhones(text);
  const media = messages.map(getMedia).filter((m): m is MediaItem => m !== null);

  if (phones.length === 0 && media.length === 0) return { status: "skipped" };

  if (await isSaved(key)) return { status: "duplicate" };

  const date = new Date(first.date * 1000);
  const day = date.toISOString().slice(0, 10);
  const errors: string[] = [];
  const links: string[] = [];

  for (const [index, item] of media.entries()) {
    const name = `${day}_${item.messageId}${index ? `_${index + 1}` : ""}${item.extension}`;
    try {
      if (item.fileSize && item.fileSize > MAX_TELEGRAM_DOWNLOAD_BYTES) {
        throw new Error(`${name} is ${(item.fileSize / 1024 / 1024).toFixed(1)} MB, bots can only download up to 20 MB`);
      }
      const buffer = await downloadFile(api, item.fileId);
      const id = await uploadFile({ name, mimeType: item.mimeType, parentId: config.googleMediaFolderId, buffer });
      links.push(fileUrl(id));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      links.push("⚠️ file not saved, open the post in Telegram");
    }
  }

  const post: BackupPost = {
    messageKey: key,
    text,
    date,
    author: getAuthor(first),
    postLink: getPostLink(first.chat, first.message_id),
    media: links,
    source: "bot",
  };
  const rows = buildRows(post, config.timeZone);
  await appendRows(config.googleSpreadsheetId, rows);
  savedKeys!.add(key);

  return { status: "saved", rows: rows.length, phones, media: links.length - errors.length, errors };
}
