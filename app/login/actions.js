"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionClient } from "../../lib/auth";

/**
 * Hand off to Microsoft.
 *
 * Supabase calls the provider `azure`; it is Entra ID. The three scopes are the
 * only ones the app registration asks for, and `email` is the one that matters —
 * it is the single claim this app trusts, and the key into app_users.
 *
 * redirectTo is built from the request's own host rather than from an env var,
 * so a Vercel preview deployment returns to itself instead of to production.
 * Supabase will only honour a URL on its redirect allowlist, so a forged Host
 * header cannot send the code anywhere new — see AUTH_PLAN 5b.
 */
export async function signInWithMicrosoft() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${h.get("host")}`;

  const { data, error } = await sessionClient().auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: `${origin}/auth/callback`,
      scopes: "openid email profile",
    },
  });

  if (error || !data?.url) {
    redirect(`/login?err=${encodeURIComponent(error?.message ?? "sign-in is unavailable")}`);
  }
  redirect(data.url);
}
