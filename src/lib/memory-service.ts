import { WhisperContext } from "@usewhisper/sdk";
import { env, isWhisperConfigured } from "@/lib/env";
import { getErrorMessage } from "@/lib/error-utils";
import {
  localCaptureMessages,
  localClearUserMemories,
  localDeleteMemory,
  localGetContext,
  localListMemories,
  localUpdateMemory,
} from "@/lib/local-memory-store";
import type { MemoryRecord, UsedMemory } from "@/lib/types";

export interface ContextLookupResult {
  context: string;
  usedMemories: UsedMemory[];
  contextCount: number;
  latencyMs: number;
}

export interface MemoryService {
  getContext(args: {
    userId: string;
    sessionId: string;
    query: string;
  }): Promise<ContextLookupResult>;
  captureSession(args: {
    userId: string;
    sessionId: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<{ extracted: number; latencyMs: number }>;
  listUserMemories(userId: string): Promise<MemoryRecord[]>;
  updateMemory(memoryId: string, content: string): Promise<void>;
  deleteMemory(memoryId: string): Promise<void>;
  clearUserMemories(userId: string): Promise<number>;
}

const MEMORY_TYPES = new Set([
  "factual",
  "preference",
  "event",
  "relationship",
  "opinion",
  "goal",
  "instruction",
  "episodic",
  "semantic",
  "procedural",
]);

const contextCache = new Map<string, { expiresAt: number; value: ContextLookupResult }>();
const CONTEXT_CACHE_TTL_MS = 15_000;

let whisperContextClient: WhisperContext | null = null;

function requireWhisperApiKey() {
  if (!isWhisperConfigured()) {
    throw new Error("WHISPER_API_KEY is required to use memory APIs.");
  }
}

function getWhisperContextClient() {
  requireWhisperApiKey();
  if (!whisperContextClient) {
    whisperContextClient = new WhisperContext({
      apiKey: env.WHISPER_API_KEY!,
      project: env.WHISPER_PROJECT,
      baseUrl: env.WHISPER_BASE_URL,
      timeoutMs: 3_000,
      retry: {
        maxAttempts: 2,
      },
    });
  }
  return whisperContextClient;
}

function shouldFallbackToLocal(error: unknown) {
  const err = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : "";
  const status = typeof err.status === "number" ? err.status : -1;
  const message = typeof err.message === "string" ? err.message.toLowerCase() : "";

  return (
    !isWhisperConfigured() ||
    status >= 500 ||
    status === 404 ||
    code === "PROJECT_NOT_FOUND" ||
    code === "MISSING_PROJECT" ||
    code === "ENDPOINT_NOT_FOUND" ||
    message.includes("project not found") ||
    message.includes("not found") ||
    message.includes("internal server error") ||
    message.includes("endpoint not found")
  );
}

function toCacheKey(userId: string, sessionId: string, query: string) {
  return `${userId}::${sessionId}::${query.trim().toLowerCase()}`;
}

function clearContextCacheForUser(userId: string) {
  const prefix = `${userId}::`;
  for (const key of contextCache.keys()) {
    if (key.startsWith(prefix)) {
      contextCache.delete(key);
    }
  }
}

function trimValue(value: string, limit = 120) {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}...`;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function scoreMemoryMatch(query: string, content: string) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }
  const contentTokens = new Set(tokenize(content));
  let matched = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      matched += 1;
    }
  }
  return matched / queryTokens.length;
}

function toUsedMemories(results: Array<Record<string, unknown>>): UsedMemory[] {
  return results
    .map((result) => {
      const nestedMemory =
        result.memory && typeof result.memory === "object"
          ? (result.memory as Record<string, unknown>)
          : result;
      return {
        id: String(nestedMemory.id ?? result.id ?? crypto.randomUUID()),
        content: trimValue(String(nestedMemory.content ?? result.content ?? "")),
        score: Number(result.similarity ?? result.score ?? 0),
        type: String(nestedMemory.type ?? result.type ?? "memory"),
        retrievalSource: String(result.retrieval_source ?? ""),
      };
    })
    .filter((result) => {
      const type = result.type;
      const retrievalSource = result.retrievalSource;
      return MEMORY_TYPES.has(type) || retrievalSource.toLowerCase() === "memory";
    })
    .slice(0, 4)
    .map(({ id, content, score, type }) => ({
      id,
      content,
      score,
      type,
    }));
}

function toMemoryRecord(value: Record<string, unknown>): MemoryRecord {
  return {
    id: String(value.id ?? value.memory_id ?? ""),
    content: String(value.content ?? value.text ?? ""),
    memoryType: String(value.memoryType ?? value.memory_type ?? value.type ?? "factual"),
    importance: Number(value.importance ?? 0),
    createdAt: value.createdAt
      ? String(value.createdAt)
      : value.created_at
        ? String(value.created_at)
        : undefined,
    updatedAt: value.updatedAt
      ? String(value.updatedAt)
      : value.updated_at
        ? String(value.updated_at)
        : undefined,
    userId: value.userId
      ? String(value.userId)
      : value.user_id
        ? String(value.user_id)
        : undefined,
  };
}

function toContextFromMemories(query: string, memoryList: MemoryRecord[], latencyMs: number): ContextLookupResult {
  const ranked = memoryList
    .filter((memory) => memory.content.trim().length > 0)
    .map((memory) => ({
      memory,
      score: scoreMemoryMatch(query, memory.content),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const usedMemories = ranked
    .filter((entry) => entry.score > 0)
    .map((entry) => ({
      id: entry.memory.id,
      content: trimValue(entry.memory.content),
      score: entry.score,
      type: entry.memory.memoryType,
    }));

  const context = usedMemories
    .map((entry, index) => `[${index + 1}] ${entry.content}`)
    .join("\n");

  return {
    context,
    usedMemories,
    contextCount: usedMemories.length,
    latencyMs,
  };
}

export class WhisperMemoryService implements MemoryService {
  async getContext(args: { userId: string; sessionId: string; query: string }): Promise<ContextLookupResult> {
    const cacheKey = toCacheKey(args.userId, args.sessionId, args.query);
    const cached = contextCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const startedAt = Date.now();
    let response;
    let searchError: unknown;
    try {
      response = await getWhisperContextClient().memory.search({
        project: env.WHISPER_PROJECT,
        query: args.query,
        user_id: args.userId,
        session_id: args.sessionId,
        top_k: 6,
      });
    } catch (error) {
      searchError = error;
      response = null;
    }

    if (!response) {
      try {
        const profileStartedAt = Date.now();
        const profile = await getWhisperContextClient().memory.getUserProfile({
          project: env.WHISPER_PROJECT,
          user_id: args.userId,
        });
        const memoryList = Array.isArray(profile.memories)
          ? (profile.memories as Array<Record<string, unknown>>).map(toMemoryRecord)
          : [];
        const profileContext = toContextFromMemories(args.query, memoryList, Date.now() - profileStartedAt);
        if (profileContext.contextCount > 0) {
          contextCache.set(cacheKey, {
            value: profileContext,
            expiresAt: now + CONTEXT_CACHE_TTL_MS,
          });
          return profileContext;
        }
      } catch {
        // No-op: local fallback below handles final recovery path.
      }

      if (shouldFallbackToLocal(searchError)) {
        const fallback = localGetContext(args.userId, args.query);
        contextCache.set(cacheKey, {
          value: fallback,
          expiresAt: now + CONTEXT_CACHE_TTL_MS,
        });
        return fallback;
      }

      throw new Error(getErrorMessage(searchError, "Failed to retrieve context from Whisper."));
    }

    const usedMemories = toUsedMemories(
      Array.isArray(response.results) ? (response.results as Array<Record<string, unknown>>) : [],
    );
    const context = usedMemories.map((entry, index) => `[${index + 1}] ${entry.content}`).join("\n");
    const remoteLatency = Number(
      response?.latency_breakdown?.total_ms ??
      response?.latency_ms ??
      Date.now() - startedAt,
    );
    const value: ContextLookupResult = {
      context,
      usedMemories,
      contextCount: Number(response.count ?? usedMemories.length),
      latencyMs: Number.isFinite(remoteLatency) ? remoteLatency : Date.now() - startedAt,
    };

    if (value.contextCount === 0) {
      const fallback = localGetContext(args.userId, args.query);
      const merged: ContextLookupResult = {
        context: fallback.context || value.context,
        usedMemories: fallback.usedMemories.length > 0 ? fallback.usedMemories : value.usedMemories,
        contextCount: fallback.contextCount > 0 ? fallback.contextCount : value.contextCount,
        latencyMs: value.latencyMs + fallback.latencyMs,
      };
      contextCache.set(cacheKey, {
        value: merged,
        expiresAt: now + CONTEXT_CACHE_TTL_MS,
      });
      return merged;
    }

    contextCache.set(cacheKey, {
      value,
      expiresAt: now + CONTEXT_CACHE_TTL_MS,
    });

    return value;
  }

  async captureSession(args: {
    userId: string;
    sessionId: string;
    messages: Array<{ role: string; content: string }>;
  }) {
    const startedAt = Date.now();
    try {
      const draftMemories = args.messages
        .filter((message) => message.content.trim().length > 0)
        .slice(-4)
        .map((message) => ({
          content: `${message.role}: ${message.content.trim().slice(0, 700)}`,
          memory_type: "event" as const,
          user_id: args.userId,
          session_id: args.sessionId,
          importance: message.role === "user" ? 0.9 : 0.72,
          confidence: 0.85,
          metadata: {
            source: "chat-demo-fast-path",
            role: message.role,
          },
        }));

      if (draftMemories.length === 0) {
        return {
          extracted: 0,
          latencyMs: Date.now() - startedAt,
        };
      }

      await getWhisperContextClient().memory.addBulk({
        project: env.WHISPER_PROJECT,
        async: true,
        memories: draftMemories,
      });

      clearContextCacheForUser(args.userId);

      return {
        extracted: draftMemories.length,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        const local = localCaptureMessages({
          userId: args.userId,
          messages: args.messages,
        });
        clearContextCacheForUser(args.userId);
        return {
          extracted: local.extracted,
          latencyMs: Date.now() - startedAt,
        };
      }
      throw new Error(getErrorMessage(error, "Failed to capture session memory."));
    }
  }

  async listUserMemories(userId: string): Promise<MemoryRecord[]> {
    let response;
    try {
      response = await getWhisperContextClient().memory.getUserProfile({
        project: env.WHISPER_PROJECT,
        user_id: userId,
      });
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        return localListMemories(userId);
      }
      throw new Error(getErrorMessage(error, "Failed to list user memories."));
    }

    const memoryList = Array.isArray(response.memories)
      ? (response.memories as Array<Record<string, unknown>>)
      : [];
    const remote = memoryList.map(toMemoryRecord);
    const local = localListMemories(userId);
    return remote.length > 0 ? remote : local;
  }

  async updateMemory(memoryId: string, content: string): Promise<void> {
    const localUpdated = localUpdateMemory(memoryId, content);
    try {
      await getWhisperContextClient().memory.update(memoryId, { content });
    } catch (error) {
      if (shouldFallbackToLocal(error) && localUpdated) {
        return;
      }
      throw new Error(getErrorMessage(error, "Failed to update memory."));
    }
  }

  async deleteMemory(memoryId: string): Promise<void> {
    const localDeleted = localDeleteMemory(memoryId);
    try {
      await getWhisperContextClient().memory.delete(memoryId);
    } catch (error) {
      if (shouldFallbackToLocal(error) && localDeleted) {
        return;
      }
      throw new Error(getErrorMessage(error, "Failed to delete memory."));
    }
  }

  async clearUserMemories(userId: string): Promise<number> {
    const localCount = localClearUserMemories(userId);
    try {
      const memories = await this.listUserMemories(userId);
      const remoteMemories = memories.filter((memory) => !memory.id.startsWith("local-"));
      await Promise.all(remoteMemories.map((memory) => this.deleteMemory(memory.id)));
      return Math.max(localCount, memories.length);
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        return localCount;
      }
      throw error;
    }
  }
}
