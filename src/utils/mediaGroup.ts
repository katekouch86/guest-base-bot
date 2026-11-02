import type { Message } from "grammy/types";

export function createMediaGroupBuffer(
  onFlush: (messages: Message[]) => Promise<void>,
  delayMs = 2_000,
) {
  const groups = new Map<string, { messages: Message[]; timer: NodeJS.Timeout }>();

  const flush = (groupId: string): Promise<void> => {
    const group = groups.get(groupId);
    if (!group) return Promise.resolve();

    clearTimeout(group.timer);
    groups.delete(groupId);
    return onFlush(group.messages.sort((a, b) => a.message_id - b.message_id));
  };

  return {
    add(groupId: string, message: Message): void {
      const group = groups.get(groupId);
      if (group) clearTimeout(group.timer);

      const messages = group ? [...group.messages, message] : [message];
      const timer = setTimeout(() => void flush(groupId), delayMs);
      groups.set(groupId, { messages, timer });
    },

    async flushAll(): Promise<void> {
      await Promise.all([...groups.keys()].map(flush));
    },
  };
}
