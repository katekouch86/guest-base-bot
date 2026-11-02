import { extractPhones, stripPhones } from "../utils/phone";

export const MEDIA_COLUMNS = 4;

export const COLUMNS = [
  "Phone",
  "Info",
  "Date",
  "Author",
  ...Array.from({ length: MEDIA_COLUMNS }, (_, i) => `Media ${i + 1}`),
  "Full post",
  "Post link",
  "Message ID",
  "Source",
] as const;

export const PHONE_COLUMN = COLUMNS.indexOf("Phone");
export const MESSAGE_ID_COLUMN = COLUMNS.indexOf("Message ID");

export interface BackupPost {
  messageKey: string;
  text: string;
  date: Date;
  author: string;
  postLink: string;
  media: string[];
  source: "bot" | "import";
}

export interface PhoneSegment {
  phone: string;
  info: string;
}

export function splitByPhones(text: string): PhoneSegment[] {
  const header: string[] = [];
  const groups: { phones: string[]; lines: string[] }[] = [];

  for (const line of text.split("\n")) {
    const phones = extractPhones(line);
    if (phones.length > 0) {
      groups.push({ phones, lines: [line.trim()] });
    } else if (groups.length > 0) {
      groups[groups.length - 1].lines.push(line.trim());
    } else {
      header.push(line.trim());
    }
  }

  const clean = (lines: string[]) => lines.filter(Boolean).join("\n");
  const seen = new Set<string>();
  const segments: PhoneSegment[] = [];

  for (const group of groups) {
    const info = stripPhones(clean([...header, ...group.lines]));
    for (const phone of group.phones) {
      if (seen.has(phone)) continue;
      seen.add(phone);
      segments.push({ phone, info });
    }
  }
  return segments;
}

export function formatDate(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function mediaCells(media: string[]): string[] {
  const cells = media.slice(0, MEDIA_COLUMNS - 1);
  const rest = media.slice(MEDIA_COLUMNS - 1);
  cells.push(rest.join("\n"));
  while (cells.length < MEDIA_COLUMNS) cells.push("");
  return cells.slice(0, MEDIA_COLUMNS);
}

export function buildRows(post: BackupPost, timeZone: string): string[][] {
  const segments = splitByPhones(post.text);
  const multiple = segments.length > 1;
  const rowsFor = segments.length > 0 ? segments : [{ phone: "", info: post.text.trim() }];

  return rowsFor.map(({ phone, info }) => [
    phone,
    info,
    formatDate(post.date, timeZone),
    post.author,
    ...mediaCells(post.media),
    multiple ? post.text.trim() : "",
    post.postLink,
    post.messageKey,
    post.source,
  ]);
}
