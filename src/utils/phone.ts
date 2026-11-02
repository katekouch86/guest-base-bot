import { parsePhoneNumberFromString } from "libphonenumber-js";

const DEFAULT_COUNTRY = "IT";

// Telegram often separates digits with non-breaking spaces (U+00A0, U+202F) and hyphens (U+2011).
const CANDIDATE = /\+?\d[\d \t\u00a0\u2007\u2009\u202f().\-\u2010-\u2015\u2212]{6,}\d/g;

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  const international = raw.trim().startsWith("+");
  const parsed = parsePhoneNumberFromString(raw, DEFAULT_COUNTRY);

  if (international) {
    if (parsed?.isValid()) return parsed.number;

    const groups = raw.trim().split(/[^\d+]+/);
    for (let end = groups.length - 1; end > 0; end--) {
      const shorter = parsePhoneNumberFromString(groups.slice(0, end).join(" "), DEFAULT_COUNTRY);
      if (shorter?.isValid()) return shorter.number;
    }

    return parsed?.isPossible() ? parsed.number : `+${digits}`;
  }

  return parsed?.isValid() ? parsed.number : null;
}

interface FoundPhone {
  phone: string;
  start: number;
  end: number;
}

function findPhones(text: string): FoundPhone[] {
  const found: FoundPhone[] = [];

  for (const match of text.matchAll(CANDIDATE)) {
    const candidate = match[0].split(/[ \t\u00a0\u2007\u2009\u202f]{2,}/)[0];

    const next = text[match.index + match[0].length] ?? "";
    const glued = candidate === match[0] && /\p{L}/u.test(next);
    const shorter = glued ? candidate.replace(/[^\d]+\d+$/, "") : "";
    const trimmed = shorter ? parsePhoneNumberFromString(shorter, DEFAULT_COUNTRY) : undefined;

    const raw = trimmed?.isValid() ? shorter : candidate;
    const phone = trimmed?.isValid() ? trimmed.number : normalizePhone(candidate);
    if (phone) found.push({ phone, start: match.index, end: match.index + raw.length });
  }
  return found;
}

export function extractPhones(text?: string | null): string[] {
  if (!text) return [];
  return [...new Set(findPhones(text).map((p) => p.phone))];
}

export function stripPhones(text: string): string {
  let result = "";
  let last = 0;
  for (const { start, end } of findPhones(text)) {
    result += text.slice(last, start);
    last = end + (text.slice(end).match(/^[ \t\u00a0\-–—|,;/]*/)?.[0].length ?? 0);
  }
  result += text.slice(last);

  return result
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]{2,}/g, " ").replace(/^[\s\-–—:|,.;/]+|[\s\-–—:|,;/]+$/g, ""))
    .filter(Boolean)
    .join("\n");
}
