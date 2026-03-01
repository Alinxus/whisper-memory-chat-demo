import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/error-utils";
import { getMemoryRuntime } from "@/lib/server/chat-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  userId: z.string().min(1),
});

export async function GET(request: NextRequest) {
  try {
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    const { userId } = querySchema.parse(query);
    const memories = await getMemoryRuntime().listUserMemories(userId);
    return NextResponse.json({ ok: true, memories });
  } catch (error) {
    const message = getErrorMessage(error, "Failed to list memories.");
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    const { userId } = querySchema.parse(query);
    const deletedCount = await getMemoryRuntime().clearUserMemories(userId);
    return NextResponse.json({ ok: true, deletedCount });
  } catch (error) {
    const message = getErrorMessage(error, "Failed to clear memories.");
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
