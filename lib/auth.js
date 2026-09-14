import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/**
 * Who is asking.
 *
 * Two Supabase clients live in this app and they must not be merged.
 *
 *   lib/db.js    the data client. Reads and writes every table.
 *   lib/auth.js  this one. Reads and refreshes the session, and looks up one
 *                row in app_users. Never touches data.
 *
 * The session half runs on the anon key against /auth/v1, which is GoTrue — a
 * different service from PostgREST that does not consult `public` schema
 * privileges. That is why revoking anon's table grants later (AUTH_PLAN step
 * 10) will not break signing in.
 *
 * The lookup half runs on the service role, because app_users has RLS on and
 * deliberately no policy: anon and authenticated can read nothing from it. An
 * allowlist the browser can read is an allowlist that tells a stranger who
 * works here.
 */

// The URL is not a credential and is already public in lib/db.js, so it may
// fall back. The keys may not: a missing key has to be loud. Falling back to
// anon for a service-role read would return an empty table, which looks exactly
// like "this person has no row" and would silently sign everyone out of their
// own name.
const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://yfnqszwlyoyfhuwfmcyl.supabase.co";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — see AUTH_PLAN section 7`);
  return v;
}

/**
 * The session client. Created per request, because it carries that request's
 * cookies; a module-level singleton would serve one person's session to
 * everybody.
 */
export function sessionClient() {
  const jar = cookies();
  return createServerClient(SUPABASE_URL, need("SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        // A Server Component may not set cookies. That is not an error worth
        // crashing a page over: the middleware refreshes the session on every
        // request, so the write that matters has already happened there.
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {}
      },
    },
  });
}

/** The app_users lookup. Service role, no session, never used for data. */
function directory() {
  return createClient(SUPABASE_URL, need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
    global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) },
  });
}

/**
 * The stub from AUTH_PLAN 5a, so steps 6-13 can be built and verified before
 * IT returns the Entra registration.
 *
 * Guarded three ways rather than one, because a stub that reaches production is
 * an unauthenticated dashboard that believes it is authenticated: it is off
 * unless explicitly set, it refuses to run in a production build, and it says
 * so on every request it serves.
 */
function stubEmail() {
  const email = process.env.AUTH_STUB_EMAIL;
  if (!email) return null;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_STUB_EMAIL is set in a production build — remove it");
  }
  console.warn(`[auth] STUB: serving this request as ${email}`);
  return email.toLowerCase();
}

/**
 * The signed-in person, or null.
 *
 * Wrapped in React's cache() so a page that asks four times does one lookup per
 * request rather than four. The cache is per-request, so it cannot leak one
 * person's row into another person's render.
 *
 * Returns the app_users row plus the proven email. `rep_name` may be null: a
 * QEA address with no row signs in and reads everything, and that null is what
 * later stops it from signing a write.
 */
export const currentUser = cache(async () => {
  const stub = stubEmail();
  let email = stub;

  if (!email) {
    const { data, error } = await sessionClient().auth.getUser();
    // getUser() validates the token with the auth server rather than trusting
    // the cookie's own claims, which is the difference between a session and a
    // forged cookie.
    if (error || !data?.user?.email) return null;
    email = data.user.email.toLowerCase();
  }

  const { data: row } = await directory()
    .from("app_users")
    .select("email, display_name, rep_name")
    .eq("email", email)
    .maybeSingle();

  // Everyone with a QEA account is allowed in (settled 14 Sep), so a missing
  // row is not a refusal. It only means nobody has told this database what the
  // person is called, and the fallback display name is deliberately their
  // address — a label nobody will mistake for a rep name in the data.
  return row ?? { email, display_name: email, rep_name: null };
});

/** The signed-in person, or the login page. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The name to sign a write with.
 *
 * Every p_rep / p_logged_by argument comes from here instead of from a hidden
 * form field (AUTH_PLAN 11a). Throwing on a missing rep_name is the point: the
 * alternative is inventing one from the email local part, and a name on a call
 * that nobody can vouch for is the exact thing this change exists to stop.
 */
export async function requireRepName() {
  const user = await requireUser();
  if (!user.rep_name) {
    throw new Error(
      `${user.email} has no rep name yet, so this cannot be recorded under anyone. ` +
        `Ask Tanay to add the row in app_users.`,
    );
  }
  return user.rep_name;
}
