import { Bot, GrammyError } from "grammy";
import { config, requireEnv } from "./config/env";
import { createPostHandler } from "./handlers/posts";

requireEnv(["BOT_TOKEN", "GOOGLE_REFRESH_TOKEN", "GOOGLE_SPREADSHEET_ID", "GOOGLE_MEDIA_FOLDER_ID"]);

const bot = new Bot(config.botToken);
const posts = createPostHandler(bot.api);

bot.on("channel_post", posts.handle);
bot.on("message", posts.handle);

bot.catch((err) => {
  console.error("Bot error:", err.error);
});

let stopping = false;

const MAX_START_ATTEMPTS = 12;

async function main(): Promise<void> {
  const sources = config.sourceChatIds.length > 0 ? config.sourceChatIds.join(", ") : "all chats";
  console.log(`Bot starting... backing up ${sources} to Google (${config.backupEnv})`);

  // During a redeploy or restart the previous instance keeps polling for up to 30 s, Telegram answers 409 until it stops.
  for (let attempt = 1; ; attempt++) {
    try {
      await bot.start({ allowed_updates: ["channel_post", "message"] });
      return;
    } catch (err) {
      const conflict = err instanceof GrammyError && err.error_code === 409;
      if (!conflict || stopping || attempt >= MAX_START_ATTEMPTS) throw err;
      console.warn(`Another bot instance is still running (409), retry ${attempt} in 5s`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} received. Saving pending albums and shutting down...`);
  bot.stop()
    .then(() => posts.flush())
    .finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
