"use client";

import { useRef, useState } from "react";

const TYPES = "image/png,image/jpeg,image/webp,image/gif";

/**
 * The screenshot field, which now takes a dropped file as well as a chosen one.
 *
 * A real <input type="file"> is still underneath and still named "screenshot",
 * so the server action reads the same FormData whether the file was dropped,
 * pasted or picked, and the form keeps working with JavaScript off — the input
 * is just an ordinary file picker then.
 *
 * Dropping cannot write to input.files directly; the assignment only accepts a
 * FileList, and DataTransfer is the one way to build one.
 */
export default function ShotDrop() {
  const ref = useRef(null);
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const [why, setWhy] = useState("");

  function take(files) {
    const file = files?.[0];
    if (!file) return;
    if (!TYPES.split(",").includes(file.type)) {
      setWhy("that needs to be a PNG, JPEG, WebP or GIF");
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    ref.current.files = dt.files;
    setName(file.name);
    setWhy("");
  }

  return (
    <label
      className={`fbfile fbdrop${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      <span>
        {why || name || "Screenshot — drop one here, or click to choose"}
      </span>
      <input
        ref={ref}
        type="file"
        name="screenshot"
        accept={TYPES}
        onChange={(e) => {
          setName(e.target.files?.[0]?.name ?? "");
          setWhy("");
        }}
      />
    </label>
  );
}
