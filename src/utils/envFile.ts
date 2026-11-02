import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_FILE = ".env";

export function saveToEnv(key: string, value: string): void {
  const env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_FILE, next);
  process.env[key] = value;
}
