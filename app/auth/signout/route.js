import { NextResponse } from "next/server";
import { sessionClient } from "../../../lib/auth";

/**
 * POST only. A GET would let any image tag or link preview on any page sign the
 * person out.
 */
export async function POST(request) {
  await sessionClient().auth.signOut();
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin), {
    status: 303,
  });
}
