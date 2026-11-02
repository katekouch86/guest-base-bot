import type { Api, Context } from "grammy";
import type { Message } from "grammy/types";
import { config } from "../config/env";
import { savePost } from "../services/postService";
import { createMediaGroupBuffer } from "../utils/mediaGroup";

function isSourceChat(chatId: number): boolean {
  return config.sourceChatIds.length === 0 || config.sourceChatIds.includes(String(chatId));
}

async function notifyAdmins(api: Api, text: string): Promise<void> {
  for (const adminId of config.adminIds) {
    await api.sendMessage(adminId, text).catch((err) => console.error("Admin notify failed:", err));
  }
}

export function createPostHandler(api: Api) {
  const process = async (messages: Message[]): Promise<void> => {
    const first = messages[0];
    const where = `chat ${first.chat.id}, message ${first.message_id}`;

    try {
      const result = await savePost(api, messages);

      if (result.status !== "saved") {
        console.log(`[${result.status}] ${where}`);
        return;
      }

      console.log(
        `[saved] ${where} -> ${result.rows} row(s), phones: ${result.phones.join(", ") || "none"}, media: ${result.media}`,
      );
      if (result.errors.length > 0) {
        await notifyAdmins(api, `⚠️ Post saved (${where}) but some media failed:\n${result.errors.join("\n")}`);
      }
    } catch (err) {
      console.error(`[error] ${where}:`, err);
      await notifyAdmins(api, `❌ Failed to save post (${where}):\n${err instanceof Error ? err.message : err}`);
    }
  };

  const albums = createMediaGroupBuffer(process);

  const handle = async (ctx: Context): Promise<void> => {
    const message = ctx.channelPost ?? ctx.message;
    if (!message || message.chat.type === "private") return;

    if (!isSourceChat(message.chat.id)) {
      const title = "title" in message.chat ? message.chat.title : "";
      console.log(`Ignoring chat ${message.chat.id} "${title}" (not in SOURCE_CHAT_IDS)`);
      return;
    }

    if (message.media_group_id) {
      albums.add(message.media_group_id, message);
    } else {
      await process([message]);
    }
  };

  return { handle, flush: albums.flushAll };
}
