"use client";

// The footer shader, verbatim from the Paper file ("Swirl" node): bands of the
// QEA palette swirling around the centre, with the round QEA mark sitting on
// the swirl's eye. The shader is masked so it merges into the page along a
// slanted crack; the logo rides above the mask, unfaded.

import { useEffect, useState } from "react";
import { Swirl } from "@paper-design/shaders-react";

// One SVG mask: a jagged path staggering around a level line (y≈24, same on
// both walls), blurred so the break stays soft — the ragged fade without the
// tilt. A single mask layer — no gradient compositing to flatten the texture.
const CRACK = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>" +
    "<defs><filter id='b' x='-20%' y='-60%' width='140%' height='220%'>" +
    "<feGaussianBlur stdDeviation='3.5'/></filter></defs>" +
    "<path filter='url(#b)' fill='black' d='M0 24 L8 20 L13 28 L22 21 L30 29 " +
    "L39 22 L50 30 L59 23 L69 29 L77 21 L87 28 L100 24 L100 100 L0 100 Z'/>" +
    "</svg>",
);
const FADE = `url("data:image/svg+xml,${CRACK}")`;

export default function MeshFooter() {
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return (
    <div
      aria-hidden
      style={{ position: "relative", height: "min(36vh, 340px)", pointerEvents: "none" }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          WebkitMaskImage: FADE,
          maskImage: FADE,
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
        }}
      >
        <Swirl
          speed={still ? 0 : 0.32}
          bandCount={4}
          twist={0.1}
          scale={1}
          softness={0}
          noiseFrequency={0.4}
          noise={0.2}
          center={1}
          proportion={0.5}
          offsetX={0}
          offsetY={0}
          colors={["#010101", "#5F5F5F", "#E8094D", "#FDE3E8", "#FEFEFE"]}
          colorBack="#00000000"
          style={{ height: "100%", width: "100%" }}
        />
      </div>
      <img
        src="/qea-mark.png"
        alt=""
        width={92}
        height={92}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
        }}
      />
    </div>
  );
}
