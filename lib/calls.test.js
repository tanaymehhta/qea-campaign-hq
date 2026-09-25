import assert from "node:assert/strict";
import test from "node:test";
import { callStats } from "./calls.js";
import { shift, today } from "./db.js";

const t = today();
const contacts = [
  { id: "a", buildings_count: 63 },                          // spoke to them
  { id: "b", buildings_count: 5 },                           // voicemail only
  { id: "c", callback_date: shift(t, -1) },                  // never dialled, callback overdue
  { id: "d", dnc: true, callback_date: shift(t, -1) },       // do not call
  { id: "e", callback_date: shift(t, 1) },                   // callback is tomorrow
];
const calls = [ // newest first, as callsFor returns them
  { contact_id: "a", outcome: "booked_meeting" },
  { contact_id: "a", outcome: "not_reached" },
  { contact_id: "b", outcome: "left_email" },
  { contact_id: "b", outcome: "not_reached" },
  { contact_id: null, outcome: "spoke" },
];

test("the Calls tiles count people, not dials", () => {
  const s = callStats(contacts, calls);
  assert.equal(s.callsMade, 5);
  assert.equal(s.peopleReached, 1, "a voicemail is not a conversation");
  assert.equal(s.notReached, 1);
  assert.equal(s.buildingsCovered, 63);
  assert.equal(s.followupsDue, 1, "overdue counts, tomorrow and do-not-call do not");
  assert.equal(s.neverCalled, 2, "c and e; d is do-not-call");
  assert.equal(s.doNotCall, 1);
  assert.equal(s.meetingsBooked, 1);
});

test("meetings come from the meetings rows, and a cancelled one is out", () => {
  const meetingOf = new Map([["m1", { status: "booked" }], ["m2", { status: "cancelled" }]]);
  assert.equal(callStats(contacts, calls, meetingOf).meetingsBooked, 1);
});
