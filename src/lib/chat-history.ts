import type { ChatMessage } from "@/lib/types";

const HISTORY_LIMIT = 12;
const conversationMap = new Map<string, ChatMessage[]>();

function toKey(userId: string, sessionId: string) {
  return `${userId}::${sessionId}`;
}

export function getConversationHistory(userId: string, sessionId: string): ChatMessage[] {
  const key = toKey(userId, sessionId);
  return conversationMap.get(key) ?? [];
}

export function appendConversationMessage(
  userId: string,
  sessionId: string,
  message: ChatMessage,
): ChatMessage[] {
  const key = toKey(userId, sessionId);
  const existing = conversationMap.get(key) ?? [];
  const next = [...existing, message].slice(-HISTORY_LIMIT);
  conversationMap.set(key, next);
  return next;
}

export function clearConversation(userId: string, sessionId: string) {
  const key = toKey(userId, sessionId);
  conversationMap.delete(key);
}

