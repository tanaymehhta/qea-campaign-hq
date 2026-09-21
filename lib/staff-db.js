import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://yfnqszwlyoyfhuwfmcyl.supabase.co";

/**
 * Service-role client for staff-chat tables. Created per call.
 * app_users, hq_threads, and hq_messages have RLS and no policy, so the anon
 * client in lib/db.js cannot see them. This client never handles a session.
 */
export function staffDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — see AUTH_PLAN section 7");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false },
    global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) },
  });
}
