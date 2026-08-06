"use client";

// The QEA mesh shader (same Paper node as the footer) as a card background:
// absolutely fills whatever positioned parent it sits in.

import { useEffect, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";

export default function ShaderBg() {
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return (
    <MeshGradient
      speed={still ? 0 : 1}
      scale={1}
      distortion={0.8}
      swirl={0.1}
      colors={["#010101", "#5F5F5F", "#E8094D", "#FDE3E8", "#FEFEFE"]}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }}
    />
  );
}
