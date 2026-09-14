import { NextResponse } from "next/server";
import { sessionClient } from "../../../lib/auth";

/**
 * Where Microsoft sends the person back.
 *
 * The code in the URL is exchanged for a session server-side; the browser never
 * handles a token. A failure lands on /login with the provider's own sentence
 * rather than a crash screen, because the usual causes — a secret that expired,
 * a redirect URI that is not on the allowlist — are configuration problems and
 * the message is the only clue to which one.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const providerError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (providerError) {
    return NextResponse.redirect(
      new URL(`/login?err=${encodeURIComponent(providerError)}`, url.origin),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const { error } = await sessionClient().auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?err=${encodeURIComponent(error.message)}`, url.origin),
    );
  }
  return NextResponse.redirect(new URL("/", url.origin));
}
