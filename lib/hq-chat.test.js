import assert from "node:assert/strict";
import test from "node:test";
import { personNotes, rememberNote } from "./hq-chat.js";
import { staffDb } from "./staff-db.js";

// These write to app_users, so they need the service role key (in .env.local,
// not in a bare `npm test`). Skipped without it, same as hq-data.test.js.
const RUN = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

// A throwaway address that is not, and will never be, a real person.
const NEW = "test-remember-new@qeatech.com";
const SEEDED = "test-remember-seeded@qeatech.com";

async function drop(email) {
  await staffDb().from("app_users").delete().eq("email", email);
}

test("remember saves for a person with no app_users row", { skip: !RUN }, async () => {
  await drop(NEW);
  try {
    const saved = await rememberNote(NEW, "likes tabular answers");
    assert.equal(saved.ok, true);
    // The note reads back — the update-that-hit-zero-rows bug would lose it here.
    assert.equal(await personNotes(NEW), "likes tabular answers");
    // The insert branch had to invent a display_name; it is the email.
    const { data } = await staffDb()
      .from("app_users")
      .select("display_name, person_notes")
      .eq("email", NEW)
      .maybeSingle();
    assert.equal(data.display_name, NEW);
    assert.equal(data.person_notes, "likes tabular answers");
  } finally {
    await drop(NEW);
  }
});

test("remember appends without clobbering an existing display_name", { skip: !RUN }, async () => {
  await drop(SEEDED);
  await staffDb().from("app_users").insert({ email: SEEDED, display_name: "Real Name" });
  try {
    await rememberNote(SEEDED, "first note");
    await rememberNote(SEEDED, "second note");
    assert.equal(await personNotes(SEEDED), "first note\nsecond note");
    const { data } = await staffDb()
      .from("app_users")
      .select("display_name")
      .eq("email", SEEDED)
      .maybeSingle();
    // The update path must not overwrite the name it found.
    assert.equal(data.display_name, "Real Name");
  } finally {
    await drop(SEEDED);
  }
});
