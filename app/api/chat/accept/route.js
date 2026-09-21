import { currentUser } from "../../../../lib/auth";
import { acceptDraft } from "../../../../lib/hq-chat";

export const runtime = "nodejs";

/** The person, not the model, marks a proposal draft final. Nothing is sent. */
export async function POST(req) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in." }, { status: 401 });
  if (!user.rep_name) return Response.json({ error: "No rep name." }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const result = await acceptDraft(user.email, body.threadId);
  if (result?.error) return Response.json(result, { status: 404 });
  return Response.json(result);
}
