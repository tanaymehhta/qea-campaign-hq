#!/usr/bin/env node
/**
 * The refusals. A board that renders beautifully over a write path that
 * stopped validating is worse than no redesign, and nothing on screen would
 * show it — so this asks the database to accept four things it must not.
 *
 * Nothing here writes a row. Every call is expected to fail; a call that
 * succeeds is the failure.
 *
 *   node scripts/calls-guards.mjs
 */
const URL_ = "https://yfnqszwlyoyfhuwfmcyl.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmbnFzendseW95Zmh1d2ZtY3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDUzODQsImV4cCI6MjEwMDgyMTM4NH0.alMDnxA7VQff3A0veYqwu2sdzW7BRvTdHFjP7f4TO-A";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const CONTACT = "d4dbc69f-19e9-4241-b721-a00fe6a50ae8"; // Baris Acar, the booked meeting

let fail = 0;
async function refuses(name, fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  const body = await r.text();
  const refused = !r.ok;
  if (!refused) fail++;
  console.log(`${refused ? "  ok  " : "FAIL  "}${name.padEnd(52)} ${refused ? (JSON.parse(body).message ?? "").slice(0, 60) : "IT ACCEPTED IT — a row may have been written"}`);
}

console.log("\nTHE DATABASE MUST REFUSE\n");

await refuses("booked_meeting with no meeting date", "log_call", {
  p_contact: CONTACT, p_rep: "Mark Vasu", p_call_date: "2026-08-21",
  p_outcome: "booked_meeting", p_note: "guard test — must not be written",
  p_callback: null, p_meeting_date: null,
});
await refuses("an outcome that is not one of the four", "log_call", {
  p_contact: CONTACT, p_rep: "Mark Vasu", p_call_date: "2026-08-21",
  p_outcome: "left_voicemail", p_note: "guard test — must not be written",
  p_callback: null, p_meeting_date: null,
});
await refuses("a call against a contact that does not exist", "log_call", {
  p_contact: "00000000-0000-0000-0000-000000000000", p_rep: "Mark Vasu",
  p_call_date: "2026-08-21", p_outcome: "not_reached", p_note: "guard test",
  p_callback: null, p_meeting_date: null,
});
await refuses("retiring somebody without saying why", "set_contact_dnc", {
  p_contact: CONTACT, p_rep: "Mark Vasu", p_reason: "",
});

// RLS: the anon key the browser holds must not be able to write the table
// directly, or the security-definer functions above are decoration.
const r = await fetch(`${URL_}/rest/v1/phone_calls`, {
  method: "POST", headers: H,
  body: JSON.stringify({ contact_id: CONTACT, call_date: "2026-08-21", outcome: "not_reached", note: "guard test" }),
});
const rls = !r.ok;
if (!rls) fail++;
console.log(`${rls ? "  ok  " : "FAIL  "}${"a direct insert with the browser's key".padEnd(52)} ${rls ? `blocked (${r.status})` : "IT WROTE A ROW"}`);

console.log(fail ? `\n${fail} guard(s) did not hold.\n` : "\nEvery refusal held. No rows written.\n");
process.exit(fail ? 1 : 0);
