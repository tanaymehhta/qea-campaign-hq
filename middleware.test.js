import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Read off the file rather than imported: Next 14 has no exports map, so plain
// Node cannot resolve the `next/server` import at the top of middleware.js.
const source = fs.readFileSync(new URL("./middleware.js", import.meta.url), "utf8");
const matcher = JSON.parse(source.match(/"\/\(\(\?![^\n]*"/)[0]);
const gated = (path) => new RegExp(`^${matcher}$`).test(path);

test("every page and API route is behind the login", () => {
  for (const path of [
    "/", "/leads", "/calls/Mark%20Vasu", "/inbound/company/12", "/api/chat",
    "/api/chat/file/0b7c2a4e-1111-4222-8333-944455556666",
    // An email always has a dot in it, and a path ending ".com" reads as a file.
    "/person/jane.doe%40acme.com",
  ]) assert.ok(gated(path), `${path} is not gated`);
});

test("the login page, its OAuth routes and static files stay reachable", () => {
  for (const path of ["/login", "/auth/callback", "/auth/signout", "/_next/static/chunk.js", "/qea-mark.png", "/qea-running.mp4"]) {
    assert.ok(!gated(path), `${path} is gated`);
  }
});
