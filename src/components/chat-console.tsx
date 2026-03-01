"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, EventRecord, MemoryRecord, TurnMetrics } from "@/lib/types";

const PRESET_USERS = ["demo-alex", "demo-riley", "demo-taylor"];
const QUICK_PROMPTS = [
  "I prefer short answers and vegetarian meals.",
  "Remember I work best in the morning.",
  "What do you remember about my preferences?",
];

function createSessionId() {
  return `session-${Date.now().toString(36)}`;
}

function createEvent(level: EventRecord["level"], message: string): EventRecord {
  return {
    id: crypto.randomUUID(),
    level,
    message,
    createdAt: new Date().toISOString(),
  };
}

function formatLatency(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${Math.round(value)} ms`;
}

function formatDate(value?: string) {
  if (!value) {
    return "now";
  }
  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return value;
  }
}

function MetricTile(props: {
  label: string;
  value?: number;
  accent?: "blue" | "green" | "amber";
}) {
  const accentClass =
    props.accent === "green"
      ? "from-[#dcfae9] to-[#effcf4] text-[#126946]"
      : props.accent === "amber"
        ? "from-[#fff5d9] to-[#fffaf0] text-[#7f5a0d]"
        : "from-[#e8f0ff] to-[#f5f8ff] text-[#1346a3]";
  return (
    <div className={`rounded-xl border border-[#16354f]/15 bg-gradient-to-br p-3 ${accentClass}`}>
      <div className="text-[11px] uppercase tracking-[0.1em] opacity-75">{props.label}</div>
      <div className="mt-1 text-lg font-semibold">{formatLatency(props.value)}</div>
    </div>
  );
}

export default function ChatConsole() {
  const [userId, setUserId] = useState(PRESET_USERS[0]);
  const [sessionId, setSessionId] = useState(createSessionId());
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messagesByUser, setMessagesByUser] = useState<Record<string, ChatMessage[]>>({});
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<"connected" | "error" | "loading">("loading");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const messages = useMemo(() => messagesByUser[userId] ?? [], [messagesByUser, userId]);
  const latestMetrics = useMemo<TurnMetrics | undefined>(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate.role === "assistant" && candidate.metrics) {
        return candidate.metrics;
      }
    }
    return undefined;
  }, [messages]);

  const refreshMemories = useCallback(async (activeUser: string) => {
    try {
      setMemoryStatus("loading");
      const response = await fetch(`/api/memory?userId=${encodeURIComponent(activeUser)}`, { method: "GET" });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to fetch memory.");
      }
      setMemories(data.memories ?? []);
      setMemoryStatus("connected");
    } catch (error) {
      setMemories([]);
      setMemoryStatus("error");
      setEvents((previous) => [
        createEvent("error", error instanceof Error ? error.message : "Memory fetch failed."),
        ...previous.slice(0, 11),
      ]);
    }
  }, []);

  useEffect(() => {
    void refreshMemories(userId);
    setSessionId(createSessionId());
  }, [refreshMemories, userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };

    setMessagesByUser((previous) => ({
      ...previous,
      [userId]: [...(previous[userId] ?? []), userMessage],
    }));
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          sessionId,
          message,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Chat request failed.");
      }

      const assistantMessage = data.assistantMessage as ChatMessage;
      setMessagesByUser((previous) => ({
        ...previous,
        [userId]: [...(previous[userId] ?? []), assistantMessage],
      }));

      const extracted = assistantMessage.metrics?.extractedCount ?? 0;
      const contextCount = assistantMessage.metrics?.contextCount ?? 0;
      const memorySearchLatency =
        assistantMessage.metrics?.memorySearchLatencyMs ?? assistantMessage.metrics?.contextLatencyMs;
      const memoryWriteLatency =
        assistantMessage.metrics?.memoryWriteLatencyMs ?? assistantMessage.metrics?.captureLatencyMs;
      const whisperLatency = assistantMessage.metrics?.whisperLatencyMs ?? memorySearchLatency + memoryWriteLatency;
      const llmLatency = assistantMessage.metrics?.generationLatencyMs;

      setEvents((previous) => [
        createEvent(
          "info",
          `Whisper search ${formatLatency(memorySearchLatency)} + write ${formatLatency(memoryWriteLatency)} = ${formatLatency(whisperLatency)}. LLM ${formatLatency(llmLatency)}. E2E ${formatLatency(assistantMessage.metrics?.totalLatencyMs)}. Context hits ${contextCount}, extracted ${extracted}.`,
        ),
        ...previous.slice(0, 11),
      ]);

      await refreshMemories(userId);
    } catch (error) {
      setEvents((previous) => [
        createEvent("error", error instanceof Error ? error.message : "Chat request failed."),
        ...previous.slice(0, 11),
      ]);
    } finally {
      setIsSending(false);
    }
  }

  async function handleDeleteMemory(memoryId: string) {
    try {
      const response = await fetch(`/api/memory/${memoryId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Delete failed.");
      }
      await refreshMemories(userId);
      setEvents((previous) => [
        createEvent("info", `Memory ${memoryId.slice(0, 8)} removed.`),
        ...previous.slice(0, 11),
      ]);
    } catch (error) {
      setEvents((previous) => [
        createEvent("error", error instanceof Error ? error.message : "Delete failed."),
        ...previous.slice(0, 11),
      ]);
    }
  }

  async function handleSaveEdit(memoryId: string) {
    try {
      const content = editDraft.trim();
      if (!content) {
        return;
      }
      const response = await fetch(`/api/memory/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Update failed.");
      }

      setEditingId(null);
      setEditDraft("");
      await refreshMemories(userId);
      setEvents((previous) => [
        createEvent("info", `Memory ${memoryId.slice(0, 8)} updated.`),
        ...previous.slice(0, 11),
      ]);
    } catch (error) {
      setEvents((previous) => [
        createEvent("error", error instanceof Error ? error.message : "Update failed."),
        ...previous.slice(0, 11),
      ]);
    }
  }

  async function handleClearMemories() {
    try {
      const response = await fetch(`/api/memory?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Clear failed.");
      }
      await refreshMemories(userId);
      setEvents((previous) => [
        createEvent("info", `Cleared ${data.deletedCount} memories for ${userId}.`),
        ...previous.slice(0, 11),
      ]);
    } catch (error) {
      setEvents((previous) => [
        createEvent("error", error instanceof Error ? error.message : "Clear failed."),
        ...previous.slice(0, 11),
      ]);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-6 md:px-6">
      <header className="mb-4 rounded-2xl border border-[#16354f]/15 bg-white/80 p-4 shadow-sm backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#102a43]">Whisper Memory Chat</h1>
            <p className="text-sm text-[#335577]">Chat-style demo with user-scoped memory and latency breakdowns.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                memoryStatus === "connected"
                  ? "bg-[#d7f9e5] text-[#117a46]"
                  : memoryStatus === "loading"
                    ? "bg-[#fff2c1] text-[#8a6111]"
                    : "bg-[#ffd7db] text-[#9b1f2f]"
              }`}
            >
              Memory API: {memoryStatus}
            </span>
            <span className="rounded-full bg-[#ebf2ff] px-3 py-1 text-xs font-semibold text-[#1849a9]">
              Session {sessionId}
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {PRESET_USERS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setUserId(preset)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                userId === preset
                  ? "border-[#1e5eff] bg-[#1e5eff] text-white"
                  : "border-[#1e5eff]/25 bg-white text-[#1e5eff] hover:bg-[#eef3ff]"
              }`}
            >
              {preset}
            </button>
          ))}
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className="min-w-[180px] rounded-full border border-[#16354f]/20 bg-white px-3 py-1.5 text-xs text-[#102a43] outline-none focus:border-[#1e5eff]"
            placeholder="Custom user id"
          />
          <button
            type="button"
            onClick={() => setSessionId(createSessionId())}
            className="rounded-full border border-[#16354f]/20 bg-white px-3 py-1 text-xs font-medium text-[#102a43] hover:bg-[#f4f8ff]"
          >
            New Session
          </button>
          <button
            type="button"
            onClick={() => {
              void handleClearMemories();
            }}
            className="rounded-full border border-[#9b1f2f]/30 bg-[#fff4f5] px-3 py-1 text-xs font-medium text-[#9b1f2f] hover:bg-[#ffe8ea]"
          >
            Clear Memory
          </button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
        <section className="flex min-h-[72vh] flex-col overflow-hidden rounded-2xl border border-[#16354f]/15 bg-white/88 shadow-lg backdrop-blur-xl">
          <div className="border-b border-[#16354f]/10 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#20476d]">Conversation</h2>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#16354f]/20 bg-[#f6faff] p-4 text-sm text-[#335577]">
                Start by sharing a preference like &quot;I prefer short answers and vegetarian meals.&quot;
              </div>
            ) : null}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[94%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                  message.role === "assistant"
                    ? "mr-auto border border-[#16354f]/15 bg-[#f5f8ff] text-[#102a43]"
                    : "ml-auto bg-[#1e5eff] text-white"
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                <footer className="mt-2 flex items-center gap-2 text-[11px] opacity-80">
                  <span>{formatDate(message.createdAt)}</span>
                  {message.role === "assistant" && message.metrics ? (
                    <>
                      <span className="rounded-full bg-white/80 px-2 py-0.5 text-[#102a43]">
                        whisper {formatLatency(message.metrics.whisperLatencyMs)}
                      </span>
                      <span className="rounded-full bg-white/80 px-2 py-0.5 text-[#102a43]">
                        llm {formatLatency(message.metrics.generationLatencyMs)}
                      </span>
                    </>
                  ) : null}
                </footer>
                {message.role === "assistant" && message.usedMemories?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {message.usedMemories.map((memory) => (
                      <span
                        key={`${message.id}-${memory.id}`}
                        className="rounded-full border border-[#1e5eff]/30 bg-white px-2 py-0.5 text-[11px] text-[#1849a9]"
                        title={memory.content}
                      >
                        used: {memory.content}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
            {isSending ? (
              <div className="mr-auto max-w-[70%] rounded-2xl border border-[#16354f]/15 bg-[#f5f8ff] px-4 py-3 text-sm text-[#335577]">
                Thinking...
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleSend} className="border-t border-[#16354f]/10 p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  className="rounded-full border border-[#16354f]/20 bg-white px-2.5 py-1 text-[11px] text-[#20476d] hover:bg-[#f0f5ff]"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask something new and watch memory kick in..."
                className="flex-1 rounded-xl border border-[#16354f]/20 bg-white px-3 py-2 text-sm text-[#102a43] outline-none focus:border-[#1e5eff]"
                disabled={isSending}
              />
              <button
                type="submit"
                disabled={isSending || !input.trim()}
                className="rounded-xl bg-[#1e5eff] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#144ed8] disabled:opacity-40"
              >
                {isSending ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        </section>

        <aside className="flex min-h-[72vh] flex-col gap-4">
          <section className="rounded-2xl border border-[#16354f]/15 bg-white/88 p-4 shadow-lg backdrop-blur-xl">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#20476d]">Turn Latency</h2>
            <div className="grid grid-cols-2 gap-2">
              <MetricTile label="Whisper Search" value={latestMetrics?.memorySearchLatencyMs} accent="blue" />
              <MetricTile label="Whisper Write" value={latestMetrics?.memoryWriteLatencyMs} accent="green" />
              <MetricTile label="LLM" value={latestMetrics?.generationLatencyMs} accent="amber" />
              <MetricTile label="End-to-End" value={latestMetrics?.totalLatencyMs} accent="blue" />
            </div>
          </section>

          <section className="rounded-2xl border border-[#16354f]/15 bg-white/88 p-4 shadow-lg backdrop-blur-xl">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#20476d]">
              Saved Memory ({memories.length})
            </h2>
            <div className="max-h-[41vh] space-y-3 overflow-y-auto">
              {memories.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[#16354f]/20 bg-[#f8fbff] p-3 text-xs text-[#335577]">
                  No memories for this user yet.
                </p>
              ) : null}
              {memories.map((memory) => (
                <article key={memory.id} className="rounded-xl border border-[#16354f]/15 bg-[#f9fbff] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-[#ebf2ff] px-2 py-0.5 text-[11px] font-semibold text-[#1849a9]">
                      {memory.memoryType}
                    </span>
                    <span className="text-[11px] text-[#335577]/70">imp {memory.importance.toFixed(2)}</span>
                  </div>
                  {editingId === memory.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        className="min-h-20 w-full rounded-lg border border-[#16354f]/20 bg-white px-2 py-1 text-xs text-[#102a43] outline-none focus:border-[#1e5eff]"
                      />
                      <div className="flex gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            void handleSaveEdit(memory.id);
                          }}
                          className="rounded-md bg-[#1e5eff] px-2 py-1 font-semibold text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft("");
                          }}
                          className="rounded-md border border-[#16354f]/20 px-2 py-1 text-[#102a43]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs leading-5 text-[#102a43]">{memory.content}</p>
                  )}
                  <footer className="mt-3 flex items-center justify-between text-[11px] text-[#335577]/70">
                    <span>{formatDate(memory.updatedAt || memory.createdAt)}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(memory.id);
                          setEditDraft(memory.content);
                        }}
                        className="rounded-md border border-[#16354f]/20 px-2 py-0.5 hover:bg-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleDeleteMemory(memory.id);
                        }}
                        className="rounded-md border border-[#9b1f2f]/30 px-2 py-0.5 text-[#9b1f2f] hover:bg-[#ffe8ea]"
                      >
                        Forget
                      </button>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[#16354f]/15 bg-white/88 p-4 shadow-lg backdrop-blur-xl">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#20476d]">Event Log</h2>
            <div className="max-h-[18vh] space-y-2 overflow-y-auto text-xs">
              {events.length === 0 ? <p className="text-[#335577]/70">Waiting for first chat turn...</p> : null}
              {events.map((event) => (
                <div
                  key={event.id}
                  className={`rounded-lg px-2 py-1 ${
                    event.level === "error" ? "bg-[#fff0f2] text-[#9b1f2f]" : "bg-[#ecf8f1] text-[#166b45]"
                  }`}
                >
                  <div>{event.message}</div>
                  <div className="opacity-70">{formatDate(event.createdAt)}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
