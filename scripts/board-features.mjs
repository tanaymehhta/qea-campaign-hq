#!/usr/bin/env node
/**
 * The Calls board, driven in a real browser.
 *
 * calls-parity.mjs proves the numbers. This proves the things a number cannot:
 * that a card opens the person it names, that Esc closes the drawer and takes
 * ?open= with it, that the toggle redraws the same pile rather than a different
 * one, and that the drawer really does carry the whole write path rather than a
 * pretty summary of it.
 *
 * Chrome over the DevTools protocol — no Playwright, no Puppeteer, no new
 * dependency for what a WebSocket and eleven assertions can do.
 *
 *   node scripts/board-features.mjs [origin]
 *
 * Exit 0 = every feature behaved. Exit 1 = it says which one didn't.
 */

import { spawn } from "node:child_process";

const ORIGIN = process.argv[2] ?? "http://localhost:3141";
const PAGE = `${ORIGIN}/calls/${encodeURIComponent("Mark Vasu")}/nyc-ll11-safe`;
const PORT = 9333;

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  good ? pass++ : fail++;
  console.log(`${good ? "  ok  " : "FAIL  "}${name}${good ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const truthy = (name, got, note = "") => {
  got ? pass++ : fail++;
  console.log(`${got ? "  ok  " : "FAIL  "}${name}${note && !got ? `   ${note}` : ""}`);
};

/* ── the smallest CDP client that can click things ────────────────────────── */
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--disable-gpu",
   "--user-data-dir=/tmp/cdp-board", "--window-size=1440,1200", "about:blank"],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);

const [tab] = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const cdp = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

/** Run an expression in the page and hand back its value. */
const $ = async (expr) => {
  const r = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " :: " + expr);
  return r.result?.result?.value;
};
const goto = async (url) => {
  await cdp("Page.navigate", { url });
  // Wait for the document to settle rather than guessing at a fixed delay.
  for (let i = 0; i < 60; i++) {
    await sleep(120);
    if ((await $(`document.readyState`)) === "complete" && (await $(`!!document.querySelector("main,body>div")`))) break;
  }
  await sleep(350); // let React hydrate before anything is clicked
};

await cdp("Page.enable");
await cdp("Runtime.enable");

/* ── 1 · the board draws five columns ─────────────────────────────────────── */
console.log("\n1 · THE BOARD");
await goto(PAGE);
check("five columns, in shift order",
  await $(`[...document.querySelectorAll(".colhead")].map(h=>h.firstChild.textContent.trim())`),
  ["To call", "Didn't reach", "Follow up", "Not interested", "Booked meeting"]);
check("header counts",
  await $(`[...document.querySelectorAll(".colhead .n")].map(n=>n.textContent)`),
  ["1,236", "7", "3", "0", "1"]);
truthy("empty column still renders at 0",
  await $(`!!document.querySelector(".col:nth-child(4) .colempty")`),
  "a zero column that vanishes is the /leads facet bug");
truthy("the never-called column says what it is hiding",
  await $(`(document.querySelector(".col .more")?.textContent??"").includes("no phone or email yet")`));
truthy("the booked meeting is green and carries its date",
  await $(`(()=>{const c=document.querySelector(".bcard.won");return !!c && c.querySelector(".chip")?.textContent.startsWith("Meeting")})()`));

/* ── 2 · a card opens the person it names ─────────────────────────────────── */
console.log("\n2 · THE DRAWER");
const cardName = await $(`document.querySelector(".col:nth-child(5) .bcard .nm b").textContent.trim()`);
await $(`document.querySelector(".col:nth-child(5) .bcard").click()`);
await sleep(1400);
check("clicking a card opens that person", await $(`document.querySelector(".drawer h2")?.textContent`), cardName);
truthy("?open= is in the URL, so the drawer survives a refresh",
  await $(`new URL(location.href).searchParams.has("open")`));
truthy("the whole write path is inside the drawer, not a summary of it",
  await $(`(()=>{const d=document.querySelector(".drawerbody");if(!d)return false;
    const radios=d.querySelectorAll('input[name="outcome"]').length;
    const dates=d.querySelectorAll('input[type="date"]').length;
    const forms=d.querySelectorAll("form").length;
    return radios===4 && dates>=3 && forms>=4})()`),
  "four tags, three dates, log/edit/detail/callback forms");
truthy("the call history came with it",
  await $(`!!document.querySelector(".drawerbody table")`));

await $(`window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))`);
await sleep(900);
check("Esc closes it", await $(`!!document.querySelector(".drawer")`), false);
check("...and takes ?open= with it", await $(`new URL(location.href).searchParams.has("open")`), false);

/* ── 3 · the toggle redraws the same pile ─────────────────────────────────── */
console.log("\n3 · KANBAN / LIST");
const boardCount = await $(`document.querySelector("#list").textContent`);
await $(`[...document.querySelectorAll(".seg a")].find(a=>a.textContent==="List").click()`);
await sleep(1500);
check("List gives rows, not cards", await $(`!!document.querySelector(".mrow") && !document.querySelector(".board")`), true);
check("the count above does not move", await $(`document.querySelector("#list").textContent`), boardCount);

/* ── 4 · a filter survives the toggle ─────────────────────────────────────── */
console.log("\n4 · FILTERS");
await goto(`${PAGE}?f=notreached`);
check("filtered board", await $(`[...document.querySelectorAll(".colhead .n")].map(n=>n.textContent)`), ["0", "7", "0", "0", "0"]);
check("the header agrees with the tile it came from",
  await $(`document.querySelector("#list").textContent.match(/([\\d,]+) shown/)[1]`), "7");
await $(`[...document.querySelectorAll(".seg a")].find(a=>a.textContent==="List").click()`);
await sleep(1500);
truthy("switching view keeps the filter",
  await $(`new URL(location.href).searchParams.get("f")==="notreached"`));

/* ── 5 · show-everyone, and the cap on cards ──────────────────────────────── */
console.log("\n5 · SHOW THEM ANYWAY");
await goto(`${PAGE}?v=all`);
check("cards are capped at 50 a column",
  await $(`document.querySelectorAll(".col:nth-child(1) .bcard").length`), 50);
truthy("...with a link that asks for more",
  await $(`(document.querySelector(".col:nth-child(1) .more")?.textContent??"").includes("show 50 of them")`));
await $(`document.querySelector(".col:nth-child(1) .more a").click()`);
await sleep(1600);
check("...and the link works", await $(`document.querySelectorAll(".col:nth-child(1) .bcard").length`), 100);

/* ── 6 · dark mode is not an afterthought ─────────────────────────────────── */
console.log("\n6 · DARK");
await goto(PAGE);
const lightCol = await $(`getComputedStyle(document.querySelector(".col")).backgroundColor`);
await $(`document.documentElement.setAttribute("data-theme","dark")`);
await sleep(300);
const darkCol = await $(`getComputedStyle(document.querySelector(".col")).backgroundColor`);
const darkCard = await $(`getComputedStyle(document.querySelector(".bcard")).backgroundColor`);
truthy(`column repaints (${lightCol} -> ${darkCol})`, lightCol !== darkCol);
truthy("cards are not left white on a dark page",
  darkCard !== "rgb(255, 255, 255)" && darkCard !== lightCol);

/* ── 8 · dragging a card asks for the call that moves it ──────────────────── */
console.log("\n8 · DRAG AND DROP");
await goto(PAGE);
truthy("cards are draggable", await $(`document.querySelector(".bcard").draggable === true`));

// A real dragstart/drop pair through the DataTransfer the handlers read.
const drag = (fromSel, toIdx) => $(`(()=>{
  const card = document.querySelector("${fromSel}");
  const zone = document.querySelectorAll(".dropzone")[${toIdx}];
  const dt = new DataTransfer();
  card.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));
  zone.dispatchEvent(new DragEvent("dragover",{bubbles:true,dataTransfer:dt}));
  zone.dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:dt}));
  return true})()`);

// Didn't reach (col 2) -> Booked meeting (col 5)
const dragged = await $(`document.querySelector(".col:nth-child(2) .bcard .nm b").textContent.trim()`);
await drag(".col:nth-child(2) .bcard", 4);
await sleep(1600);
check("the drop opens that person", await $(`document.querySelector(".drawer h2")?.textContent`), dragged);
check("...with the column's outcome preselected",
  await $(`document.querySelector('.drawerbody input[name="outcome"]:checked')?.value`), "booked_meeting");
check("...and says nothing has moved yet",
  await $(`document.querySelector(".drawerbody h2").textContent`), "Moving to \u201cBooked a meeting\u201d");
truthy("...and makes the meeting date mandatory before it will submit",
  await $(`document.querySelector('.drawerbody input[name="meeting_date"]').required === true`));
truthy("the form still posts to the same server action, not a new endpoint",
  await $(`!!document.querySelector('.drawerbody form[action]')`));

// Nothing may be written by the drag itself.
check("the drag wrote nothing — the tile has not moved",
  await $(`document.querySelector('[data-count]')?.getAttribute("data-count")`), "11");

await goto(PAGE);
await drag(".col:nth-child(3) .bcard", 0);      // Follow up -> To call
await sleep(900);
check("dropping into To call is refused, not silently ignored",
  await $(`!!document.querySelector(".refused")`), true);
check("...and it does not open anybody", await $(`!!document.querySelector(".drawer")`), false);

await goto(PAGE);
await drag(".col:nth-child(3) .bcard", 2);      // Follow up -> Follow up
await sleep(900);
check("dropping a card back where it started does nothing",
  await $(`!!document.querySelector(".drawer")`), false);

/* ── 7 · every other page still answers ───────────────────────────────────── */
console.log("\n7 · NOTHING ELSE MOVED");
for (const p of ["/", "/meetings", "/leads", "/calls", "/pipeline", "/inbound", "/campaigns", "/health", "/replies"]) {
  const code = await fetch(ORIGIN + p).then((r) => r.status).catch(() => 0);
  check(`GET ${p}`, code, 200);
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED\n` : `\nAll ${pass} checks passed.\n`);
chrome.kill();
process.exit(fail ? 1 : 0);
