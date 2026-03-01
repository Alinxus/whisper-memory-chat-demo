export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  usedMemories?: UsedMemory[];
  metrics?: TurnMetrics;
}

export interface UsedMemory {
  id: string;
  content: string;
  score: number;
  type: string;
}

export interface TurnMetrics {
  totalLatencyMs: number;
  whisperLatencyMs: number;
  memorySearchLatencyMs: number;
  memoryWriteLatencyMs: number;
  contextLatencyMs: number;
  generationLatencyMs: number;
  captureLatencyMs: number;
  extractedCount: number;
  contextCount: number;
}

export interface MemoryRecord {
  id: string;
  content: string;
  memoryType: string;
  importance: number;
  createdAt?: string;
  updatedAt?: string;
  userId?: string;
}

export interface ChatTurnInput {
  userId: string;
  sessionId: string;
  message: string;
}

export interface ChatTurnResult {
  assistantMessage: ChatMessage;
}

export interface EventRecord {
  id: string;
  level: "info" | "error";
  message: string;
  createdAt: string;
}
