// The deal name is the one thing that must be identical every single time.
// Run: deno test supabase/functions/sync/hubspot_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dealName } from "./hubspot.ts";

Deno.test("deal names, against the real company strings in the data", () => {
  // Ampersands, ALL CAPS and trailing spaces all appear in live Instantly rows.
  assertEquals(dealName("Excel Roofing & Solar"), "Excel Roofing & Solar [Outbound]");
  assertEquals(dealName("WOLF & WOLF Roof Services"), "WOLF & WOLF Roof Services [Outbound]");
  assertEquals(dealName("Iron Shield Roofing"), "Iron Shield Roofing [Outbound]");
  assertEquals(dealName("AL Pro Solutions"), "AL Pro Solutions [Outbound]");
  assertEquals(dealName("Wolfenburg Roofing "), "Wolfenburg Roofing [Outbound]");
  assertEquals(dealName("Lactalis Canada Food Service"), "Lactalis Canada Food Service [Outbound]");

  // The capitals are never corrected and never lowercased. A deal named
  // "Wolf & Wolf" and one named "WOLF & WOLF" read as two different companies.
  assertEquals(dealName("SunFlow Solar & Exteriors"), "SunFlow Solar & Exteriors [Outbound]");
});
