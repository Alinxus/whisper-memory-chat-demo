import type { MemoryRecord, UsedMemory } from "@/lib/types";

interface LocalContextResult {
  context: string;
  usedMemories: UsedMemory[];
  contextCount: number;
  latencyMs: number;
}

const memoryByUser = new Map<string, MemoryRecord[]>();
const MEMORY_LIMIT = 120;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function toTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function scoreMatch(query: string, content: string) {
  const queryTokens = toTokens(query);
  if (queryTokens.length === 0) {
    return 0;
  }
  const contentTokens = new Set(toTokens(content));
  let matched = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      matched += 1;
    }
  }
  return matched / queryTokens.length;
}

function classifyMemoryType(content: string) {
  const lower = content.toLowerCase();
  if (/(prefer|favorite|like|dislike|allergic|diet|vegetarian|vegan)/.test(lower)) {
    return "preference";
  }
  if (/(goal|plan|want to|need to|trying to)/.test(lower)) {
    return "goal";
  }
  if (/(always|never|please|instruction|short answers|concise)/.test(lower)) {
    return "instruction";
  }
  return "factual";
}

function selectMemoryCandidates(text: string) {
  const normalized = normalizeText(text);
  const sentences = normalized
    .split(/(?<=[.!?])\s+|;\s+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const candidates = sentences.filter((sentence) =>
    /(i\s|my\s|me\s|prefer|like|want|need|allergic|always|never|work|schedule|diet|goal|instruction)/i.test(
      sentence,
    ),
  );

  return (candidates.length > 0 ? candidates : sentences.slice(0, 1)).slice(0, 3);
}

export function localCaptureMessages(args: {
  userId: string;
  messages: Array<{ role: string; content: string }>;
}) {
  const startedAt = Date.now();
  const userMessages = args.messages.filter((message) => message.role === "user");
  if (userMessages.length === 0) {
    return { extracted: 0, latencyMs: Date.now() - startedAt };
  }

  const existing = memoryByUser.get(args.userId) ?? [];
  const existingSet = new Set(existing.map((item) => item.content.toLowerCase()));
  const next = [...existing];
  let extracted = 0;

  for (const message of userMessages) {
    const candidates = selectMemoryCandidates(message.content);
    for (const candidate of candidates) {
      const normalized = normalizeText(candidate);
      if (!normalized || existingSet.has(normalized.toLowerCase())) {
        continue;
      }

      const entry: MemoryRecord = {
        id: `local-${crypto.randomUUID()}`,
        content: normalized,
        memoryType: classifyMemoryType(normalized),
        importance: 0.6,
        userId: args.userId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      next.push(entry);
      existingSet.add(normalized.toLowerCase());
      extracted += 1;
    }
  }

  memoryByUser.set(args.userId, next.slice(-MEMORY_LIMIT));
  return {
    extracted,
    latencyMs: Date.now() - startedAt,
  };
}

export function localGetContext(userId: string, query: string): LocalContextResult {
  const startedAt = Date.now();
  const items = memoryByUser.get(userId) ?? [];
  const ranked = items
    .map((item) => ({ item, score: scoreMatch(query, item.content) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (ranked.length === 0) {
    const recent = items.slice(-2).reverse();
    const usedMemories = recent.map((entry, index) => ({
      id: entry.id,
      content: entry.content,
      score: 0.25 - index * 0.05,
      type: `local-${entry.memoryType}`,
    }));
    return {
      context: usedMemories.map((entry) => `- ${entry.content}`).join("\n"),
      usedMemories,
      contextCount: usedMemories.length,
      latencyMs: Date.now() - startedAt,
    };
  }

  const usedMemories = ranked.map(({ item, score }) => ({
    id: item.id,
    content: item.content,
    score,
    type: `local-${item.memoryType}`,
  }));

  return {
    context: usedMemories.map((entry) => `- ${entry.content}`).join("\n"),
    usedMemories,
    contextCount: usedMemories.length,
    latencyMs: Date.now() - startedAt,
  };
}

export function localListMemories(userId: string): MemoryRecord[] {
  return [...(memoryByUser.get(userId) ?? [])].reverse();
}

export function localUpdateMemory(memoryId: string, content: string) {
  const nextText = normalizeText(content);
  if (!nextText) {
    return false;
  }

  for (const [userId, memories] of memoryByUser.entries()) {
    const index = memories.findIndex((entry) => entry.id === memoryId);
    if (index === -1) {
      continue;
    }
    memories[index] = {
      ...memories[index],
      content: nextText,
      memoryType: classifyMemoryType(nextText),
      updatedAt: nowIso(),
      userId,
    };
    memoryByUser.set(userId, memories);
    return true;
  }
  return false;
}

export function localDeleteMemory(memoryId: string) {
  for (const [userId, memories] of memoryByUser.entries()) {
    const next = memories.filter((entry) => entry.id !== memoryId);
    if (next.length !== memories.length) {
      memoryByUser.set(userId, next);
      return true;
    }
  }
  return false;
}

export function localClearUserMemories(userId: string) {
  const existing = memoryByUser.get(userId) ?? [];
  memoryByUser.delete(userId);
  return existing.length;
}

