"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Emails sent per day — the same chart, holding every day at once.
 *
 * Two things are different from the stacked bars this replaces, and both come
 * from one decision: the server hands over **every day there has ever been**
 * (`v_daily_facts` is 552 rows, 23 Jun onward, one page under the 1,000-row
 * cap) instead of only the days in the current window.
 *
 *   The range picker stops being a page load.  Today / 7 / 30 / 90 / All time
 *   are slices of an array that is already here, so the chart re-draws in the
 *   same frame as the click. The URL still changes — the tiles above are still
 *   the server's answer, and a range is still a shareable link — but through
 *   the router, without moving the scroll.
 *
 *   The change can be animated, because both shapes exist at once.  Bars do
 *   not cut from 7 columns to 90: the old curve and the new one are sampled as
 *   continuous curves and blended over 460ms at a blended column count, with
 *   the y-scale blended too, so the shape reflows and the axis re-zooms.
 *
 * The bars are a field of small squares rather than solid blocks. That is not
 * decoration either — it is what makes a column count change legible while it
 * is happening, because the tiles re-flow instead of stretching.
 *
 * One hue, --s1, the same blue the sent column wears everywhere else. The
 * vendor split lives in the hover readout: lemlist is being retired, and a
 * second colour on every bar to carry a share that is heading for zero is a
 * decoration the number does not need.
 */

const RANGES = [["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"]];
const SPAN = { 7: 7, 30: 30, 90: 90 };
const MORPH_MS = 460;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const isWeekend = (iso) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
const pretty = (iso) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .format(new Date(`${iso}T12:00:00Z`));
const shortDay = (iso) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })
    .format(new Date(`${iso}T12:00:00Z`));

/** A tick ceiling somebody would write down: 1, 2 or 5 × a power of ten. */
function niceTop(v) {
  if (!(v > 0)) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const step = v / mag <= 1 ? 1 : v / mag <= 2 ? 2 : v / mag <= 5 ? 5 : 10;
  return step * mag;
}

/** One spring, retargetable from wherever it currently sits. */
function makeSpring(v, k = 190, c = 27, m = 0.7) {
  let x = v, vel = 0, target = v, still = true;
  return {
    to(t, snap) { target = t; still = false; if (snap) { x = t; vel = 0; still = true; } },
    step(dt) {
      if (still) return x;
      const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.016))), h = dt / steps;
      for (let i = 0; i < steps; i++) { vel += ((-k * (x - target)) - c * vel) / m * h; x += vel * h; }
      if (Math.abs(x - target) < 0.01 && Math.abs(vel) < 0.5) { x = target; vel = 0; still = true; }
      return x;
    },
    get value() { return x; },
  };
}

export default function SendsChart({ days, range, dayPick, base }) {
  // A string, not a builder: a function cannot cross the server/client line.
  const href = (k) => `${base}${base.includes("?") ? "&" : "?"}range=${k}`;
  const router = useRouter();
  const [pending, startNav] = useTransition();
  // The range the *chart* is showing. Set on click, before the server has said
  // anything — the whole point. The prop re-syncs it on a real navigation.
  const [shown, setShown] = useState(dayPick ? "day" : range);
  useEffect(() => { setShown(dayPick ? "day" : range); }, [range, dayPick]);

  const wrap = useRef(null), cv = useRef(null), plot = useRef(null);
  const heroEl = useRef(null), tickEls = useRef([]), xEl = useRef(null);
  const tipEl = useRef(null), crossEl = useRef(null);

  // ---- the slice on screen, and the one before it for the delta ------------
  const view = useMemo(() => {
    const all = days ?? [];
    if (!all.length) return { rows: [], prev: [], label: "No sends yet", weekdays: false };
    const end = all.length - 1;
    let from = 0, label = "All time";
    if (shown === "day") {
      const i = all.findIndex((d) => d.d === dayPick);
      const one = i < 0 ? [] : [all[i]];
      return { rows: one, prev: i > 0 ? [all[i - 1]] : [], label: pretty(dayPick), weekdays: false };
    }
    if (shown === "today") { from = end; label = "Today"; }
    else if (SPAN[shown]) { from = Math.max(0, all.length - SPAN[shown]); label = `Last ${SPAN[shown]} days`; }
    const rows = all.slice(from);
    // The previous window of the same length — but only when all of it is
    // inside the data. Before 23 Jun there is nothing, and "up 400%" against a
    // window that is half empty is a sentence about the sync, not the sending.
    const len = rows.length;
    const prev = from - len >= 0 ? all.slice(from - len, from) : [];
    // Sends happen on weekdays; empty Sat/Sun columns are dead width. Display
    // only — if a weekend ever does send, the columns come back on their own.
    const weekdays =
      rows.some((d) => !isWeekend(d.d)) &&
      rows.filter((d) => isWeekend(d.d)).every((d) => !d.i && !d.l);
    return { rows: weekdays ? rows.filter((d) => !isWeekend(d.d)) : rows, prev, label, weekdays };
  }, [days, shown, dayPick]);

  const total = view.rows.reduce((a, d) => a + d.i + d.l, 0);
  const prevTotal = view.prev.reduce((a, d) => a + d.i + d.l, 0);
  const delta = view.prev.length && prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  const lem = view.rows.reduce((a, d) => a + d.l, 0);

  // ---- everything the animation loop reads, kept out of React --------------
  const anim = useRef({
    from: [], to: [], fromTop: 1, toTop: 1, t: 1, started: 0,
    hero: makeSpring(0), tipX: makeSpring(0, 650, 42, 0.5), tipY: makeSpring(0, 650, 42, 0.5),
    hover: -1, rows: [], ink: {}, reduced: false,
  });

  // New slice: keep whatever is on screen as the "from", even mid-flight.
  useEffect(() => {
    const a = anim.current;
    const vals = view.rows.map((d) => d.i + d.l);
    const top = niceTop(Math.max(1, ...vals) * 1.16);
    const now = performance.now();
    const cur = curve(a, now);
    a.from = cur.vals.length ? cur.vals : vals;
    a.fromTop = cur.top || top;
    a.to = vals;
    a.toTop = top;
    a.rows = view.rows;
    a.hover = -1;
    a.t = a.reduced ? 1 : 0;
    a.started = now;
    a.hero.to(total, a.reduced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, total]);

  // ---- the loop -----------------------------------------------------------
  useEffect(() => {
    const a = anim.current;
    a.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (a.reduced) { a.t = 1; a.hero.to(total, true); }

    const readInk = () => {
      const s = getComputedStyle(document.documentElement);
      a.ink = {
        bar: s.getPropertyValue("--s1").trim() || "#2a78d6",
        rest: s.getPropertyValue("--wash-2").trim() || "rgba(11,11,11,.045)",
        text: s.getPropertyValue("--ink-1").trim() || "#0b0b0b",
        font: getComputedStyle(document.body).fontFamily,
      };
    };
    readInk();
    const themed = new MutationObserver(readInk);
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", readInk);

    let dpr = 1, W = 0, H = 0, raf = 0, last = performance.now();
    const resize = () => {
      const el = plot.current, c = cv.current;
      if (!el || !c) return;
      const r = el.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      c.width = Math.ceil(W * dpr); c.height = Math.ceil(H * dpr);
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const c = cv.current;
      if (c) draw(c.getContext("2d"), W, H, a, now);
      if (heroEl.current) heroEl.current.textContent = fmt(a.hero.step(dt));
      paintTip(dt, W, H, a);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      scheme.removeEventListener("change", readInk);
      themed.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- drawing ------------------------------------------------------------
  function curve(a, now) {
    if (!a.to.length) return { vals: [], top: a.toTop, e: 1 };
    const t = a.t >= 1 ? 1 : clamp((now - a.started) / MORPH_MS, 0, 1);
    a.t = t;
    const e = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
    if (e >= 1 || !a.from.length) return { vals: a.to, top: a.toTop, e: 1 };
    const n = Math.max(1, Math.round(lerp(a.from.length, a.to.length, e)));
    const at = (arr, u) => {
      if (arr.length === 1) return arr[0];
      const x = u * (arr.length - 1), i = Math.floor(x);
      return lerp(arr[i], arr[Math.min(i + 1, arr.length - 1)], x - i);
    };
    const vals = new Array(n);
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1);
      vals[i] = lerp(at(a.from, u), at(a.to, u), e);
    }
    return { vals, top: lerp(a.fromTop, a.toTop, e), e };
  }

  function draw(ctx, W, H, a, now) {
    if (!W || !H) return;
    const { vals, top, e } = curve(a, now);
    ctx.clearRect(0, 0, W, H);
    if (!vals.length) return;
    ctx.imageSmoothingEnabled = false;
    const n = vals.length;
    const cell = Math.max(4, Math.round(H / 26));
    const slot = W / n;
    const barW = Math.min(slot * 0.74, W / 8);

    // The rest field: every cell carries a faint tile, so an empty day still
    // has a floor and a growing bar fills a shape rather than appearing in one.
    ctx.fillStyle = a.ink.rest;
    ctx.beginPath();
    for (let y = H - cell / 2; y > 0; y -= cell)
      for (let x = cell / 2; x < W; x += cell) ctx.rect(x - 1, y - 1, 2, 2);
    ctx.fill();

    ctx.fillStyle = a.ink.bar;
    for (let i = 0; i < n; i++) {
      const h = (vals[i] / top) * H;
      const x0 = i * slot + (slot - barW) / 2;
      const cols = Math.max(1, Math.round(barW / cell));
      const cw = barW / cols;
      const dim = a.hover >= 0 && a.hover !== i;
      ctx.globalAlpha = dim ? 0.32 : 1;
      ctx.beginPath();
      for (let col = 0; col < cols; col++) {
        const cx = x0 + cw * (col + 0.5);
        for (let y = H - cell / 2; y > H - h; y -= cell) {
          const f = (H - y) / Math.max(h, 1);           // 0 at the baseline, 1 at the top
          const s = cw * (0.62 + 0.3 * (1 - f * 0.75));
          ctx.rect(cx - s / 2, y - s / 2, s, s);
        }
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Every column's own figure — every column, no exceptions. When the slots
    // get narrow the type shrinks to fit instead of the label being dropped, so
    // 44 bars are read the same way 5 are.
    ctx.globalAlpha = e;
    ctx.fillStyle = a.ink.text;
    ctx.textAlign = "center";
    ctx.font = `600 11px ${a.ink.font}`;
    let widest = 1;
    for (let i = 0; i < n; i++) widest = Math.max(widest, ctx.measureText(fmt(vals[i])).width);
    const fs = clamp((11 * (slot - 3)) / widest, 6.5, 11);
    ctx.font = `600 ${fs.toFixed(2)}px ${a.ink.font}`;
    for (let i = 0; i < n; i++) {
      const h = (vals[i] / top) * H;
      ctx.fillText(fmt(vals[i]), i * slot + slot / 2, Math.max(fs, H - h - 5));
    }
    ctx.globalAlpha = 1;

    // The axis is four labels over the same interpolated top, so the scale
    // visibly re-zooms rather than jumping when the range changes.
    tickEls.current.forEach((el, k) => { if (el) el.textContent = fmt(top * [1, 0.66, 0.33, 0][k]); });
  }

  function paintTip(dt, W, H, a) {
    const tip = tipEl.current, cross = crossEl.current;
    if (!tip || !cross) return;
    const { vals, top } = curve(a, performance.now());
    if (a.hover < 0 || a.hover >= vals.length || !a.rows.length) {
      tip.style.opacity = 0; cross.style.opacity = 0; return;
    }
    const row = a.rows[Math.min(a.hover, a.rows.length - 1)];
    const slot = W / vals.length;
    a.tipX.to(a.hover * slot + slot / 2, a.reduced);
    a.tipY.to(H - (vals[a.hover] / top) * H, a.reduced);
    const x = a.tipX.step(dt), y = a.tipY.step(dt);
    cross.style.opacity = 1; cross.style.left = `${x}px`;
    tip.style.opacity = 1; tip.style.left = `${clamp(x, 60, W - 60)}px`; tip.style.top = `${y}px`;
    const sent = row.i + row.l;
    tip.firstChild.textContent = pretty(row.d);
    tip.lastChild.textContent = row.l
      ? `${fmt(sent)} sent · ${fmt(row.i)} Instantly · ${fmt(row.l)} lemlist`
      : `${fmt(sent)} sent`;
  }

  // Date labels are DOM, not canvas: they crossfade on a range change while the
  // bars morph underneath, which is the only part of this that should blink.
  function paintX() {
    const el = xEl.current, a = anim.current;
    if (!el) return;
    const rows = view.rows;
    el.style.opacity = 0;
    const fill = () => {
      const step = Math.max(1, Math.ceil(rows.length / 8));
      el.innerHTML = "";
      rows.forEach((d, i) => {
        if (i % step && i !== rows.length - 1) return;
        const s = document.createElement("span");
        s.textContent = rows.length <= 16 ? shortDay(d.d) : shortDay(d.d);
        s.style.left = `${((i + 0.5) / rows.length) * 100}%`;
        el.appendChild(s);
      });
      el.style.opacity = 1;
    };
    if (a.reduced) fill(); else setTimeout(fill, 150);
  }
  useEffect(paintX, [view]);

  const onPoint = (e) => {
    const a = anim.current, r = e.currentTarget.getBoundingClientRect();
    const n = curve(a, performance.now()).vals.length;
    if (!n) return;
    a.hover = clamp(Math.floor(((e.clientX - r.left) / r.width) * n), 0, n - 1);
  };

  const pick = (k) => {
    if (k === shown) return;
    setShown(k);
    // The chart has already re-drawn. This is for the tiles above, which are
    // still the server's answer to the old range — same idiom as the leads
    // rail: <html data-busy> dims what has not caught up yet.
    startNav(() => router.push(href(k), { scroll: false }));
  };
  useEffect(() => {
    const el = document.documentElement;
    if (pending) el.setAttribute("data-busy", "1");
    else el.removeAttribute("data-busy");
  }, [pending]);

  const idx = RANGES.findIndex(([k]) => k === shown);

  return (
    <div className="card sends" ref={wrap}>
      <div className="sendhead">
        <div>
          <div className="lbl">Emails sent</div>
          <div className="hero" ref={heroEl}>{fmt(total)}</div>
          <div className={`sdelta${delta > 0 ? " up" : delta < 0 ? " down" : ""}`}>
            {delta == null ? "no earlier period to compare with"
              : `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta)}% vs the previous ${
                  shown === "today" || shown === "day" ? "day" : `${SPAN[shown]} days`
                }`}
          </div>
        </div>
        <div className="spills" role="tablist" aria-label="Range">
          <span className="sknob" style={{ transform: `translateX(${idx < 0 ? 0 : idx * 100}%)`, width: `calc((100% - 6px) / ${RANGES.length})`, opacity: idx < 0 ? 0 : 1 }} />
          {RANGES.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={k === shown} onClick={() => pick(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="plotrow">
        <div className="sy">
          {[0, 1, 2, 3].map((k) => <span key={k} ref={(el) => (tickEls.current[k] = el)} style={{ top: `${(k * 100) / 3}%` }} />)}
        </div>
        <div className="splot" ref={plot}>
          <canvas ref={cv} />
          <div className="sgrid">{[0, 1, 2, 3].map((k) => <i key={k} className={k === 3 ? "base" : ""} style={{ top: `${(k * 100) / 3}%` }} />)}</div>
          <div className="scross" ref={crossEl} />
          <div className="stip" ref={tipEl}><b /><span /></div>
          <div
            className="shit"
            onPointerMove={onPoint}
            onPointerDown={onPoint}
            onPointerLeave={() => { anim.current.hover = -1; }}
          />
        </div>
      </div>
      <div className="sx" ref={xEl} />
      <div className="snote">
        {view.rows.length ? `${view.label.toLowerCase()} · ${view.rows.length} day${view.rows.length === 1 ? "" : "s"}` : "No sending days in this view"}
        {view.weekdays ? " · empty weekends hidden" : ""}
        {shown === "today" ? " · sends still in progress" : ""}
        {lem ? ` · ${fmt(lem)} of them lemlist` : ""}
      </div>
    </div>
  );
}
