# Whisper Memory Chat Demo

ChatGPT-style UI demo that uses `@usewhisper/sdk` for conversation memory:

- Memory-aware chat turns (`Whisper.getContext` + `Whisper.captureSession`)
- Memory inspector with edit / forget / clear actions (`WhisperContext.memory.*`)
- Per-user isolation demo (`demo-alex`, `demo-riley`, `demo-taylor`)
- Turn-level latency metrics and event log
- Multi-user simulation tests for isolation and p95 latency

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment:

```bash
cp .env.example .env.local
```

Set at minimum:
- `WHISPER_API_KEY`
- `WHISPER_PROJECT`

Optional:
- `OPENAI_API_KEY` for real model replies
- Without OpenAI key, the app uses a local fallback response generator

3. Run the app:

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Testing

Run full tests:

```bash
pnpm test
```

Run focused user simulation + latency test:

```bash
pnpm test:latency
```

## Demo Flow (2-3 minutes)

1. Pick `demo-alex` and state preferences in chat.
2. Ask a new question and show memory chips under the assistant reply.
3. Open memory cards on the right, edit one memory, and re-ask.
4. Click `Forget` on one memory and show behavior change.
5. Switch user to `demo-riley` to show memory isolation.

## Project Structure

- `src/components/chat-console.tsx` - main UI
- `src/app/api/chat/route.ts` - chat turn endpoint
- `src/app/api/memory/route.ts` - list/clear user memories
- `src/app/api/memory/[memoryId]/route.ts` - edit/delete single memory
- `src/lib/memory-service.ts` - Whisper SDK integration layer
- `src/lib/chat-engine.ts` - reusable chat orchestration
- `tests/*.test.ts` - isolation + latency simulations

## Notes

- This demo keeps conversation history in memory for speed.
- For production, replace in-memory history with Redis/Postgres and add auth per user.
