import { NextResponse } from "next/server";

/**
 * Same-origin proxy to the standalone proposal agent (Code/proposal_service,
 * a Qwen-via-OpenRouter agent hardcoded to the qea-proposal skill and
 * nothing else). This route has no logic of its own beyond forwarding the
 * request — the "only able to create proposals" scoping comes from the
 * agent's own system prompt on the other side, not from anything here.
 *
 * Proxying (instead of the client calling proposalservice.vercel.app
 * directly) avoids CORS and keeps the backend URL out of the client bundle.
 */
export const maxDuration = 60;

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body?.message) {
    return NextResponse.json({ error: "'message' is required" }, { status: 400 });
  }

  const base = process.env.PROPOSAL_SERVICE_URL;
  if (!base) {
    return NextResponse.json({ error: "PROPOSAL_SERVICE_URL is not configured" }, { status: 500 });
  }

  try {
    const upstream = await fetch(`${base}/api/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: body.message,
        conversation: body.conversation ?? null,
      }),
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    return NextResponse.json({ error: `proposal agent unreachable: ${e.message}` }, { status: 502 });
  }
}
