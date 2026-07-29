"use client";

import { useEffect } from "react";

/**
 * Counts every [data-count] figure up from zero once, per navigation.
 *
 * The server already rendered the final number, so this is decoration only —
 * with JS off, or if this never runs, the page still reads correctly. No dep
 * array: a navigation re-renders this and the numbers behind it together.
 */
export default function Tween() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const el of document.querySelectorAll("[data-count]")) {
      const target = Number(el.getAttribute("data-count"));
      if (!isFinite(target) || el.dataset.done === String(target)) continue;
      el.dataset.done = String(target);
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 620);
        el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString("en-US");
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  });

  return null;
}
