import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { drive, drive_v3 } from "@googleapis/drive";
import { getGoogleAuth } from "./auth";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

let client: drive_v3.Drive | null = null;

export function getDrive(): drive_v3.Drive {
  client ??= drive({ version: "v3", auth: getGoogleAuth() });
  return client;
}

export const fileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
export const spreadsheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export async function findFile(name: string, mimeType: string, parentId?: string): Promise<string | null> {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = [`name = '${escaped}'`, `mimeType = '${mimeType}'`, "trashed = false"];
  if (parentId) q.push(`'${parentId}' in parents`);

  const { data } = await getDrive().files.list({ q: q.join(" and "), fields: "files(id)", pageSize: 1 });
  return data.files?.[0]?.id ?? null;
}

export async function ensureFile(name: string, mimeType: string, parentId?: string): Promise<{ id: string; created: boolean }> {
  const existing = await findFile(name, mimeType, parentId);
  if (existing) return { id: existing, created: false };

  const { data } = await getDrive().files.create({
    requestBody: { name, mimeType, parents: parentId ? [parentId] : undefined },
    fields: "id",
  });
  return { id: data.id!, created: true };
}

export async function uploadFile(options: {
  name: string;
  mimeType: string;
  parentId: string;
  path?: string;
  buffer?: Buffer;
}): Promise<string> {
  const body = options.path ? createReadStream(options.path) : Readable.from(options.buffer!);

  const { data } = await getDrive().files.create({
    requestBody: { name: options.name, parents: [options.parentId] },
    media: { mimeType: options.mimeType, body },
    fields: "id",
  });
  return data.id!;
}
