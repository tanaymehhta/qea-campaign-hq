"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// A Letter page at 96 dpi. docx-preview draws each page 612pt wide; the strip
// and the panel shrink it with `zoom`, which also keeps Chrome from inflating
// tiny text the way a transform does not.
// ponytail: assumes portrait Letter, true of every page the proposal template makes.
const PAGE_W = 816;

const DOWN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" />
  </svg>
);
const SPLIT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M14 4v16" />
  </svg>
);
const CLOSE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// One fetch and one render per file, shared by the strip and the panel. The
// finished pages are also kept by id so the panel's first frame already has
// them, which is the frame the view transition snapshots.
const jobs = new Map();
const ready = new Map();

/**
 * The file's pages as docx-preview draws them. It breaks only where the file
 * says a page ends (manual breaks, and the breaks Word recorded when it last
 * laid the document out), so a page that overflowed in Word is one long page here.
 */
function renderFile(id) {
  if (!jobs.has(id)) {
    const job = (async () => {
      const [{ renderAsync }, res] = await Promise.all([
        import("docx-preview"),
        fetch(`/api/chat/file/${id}`),
      ]);
      if (!res.ok) throw new Error(res.status === 404 ? "File not found." : `Could not load the pages (${res.status}).`);
      // The styles docx-preview writes are global, scoped by this class name;
      // the host stays in the page, hidden, so they keep applying to the copies.
      const host = document.createElement("div");
      host.hidden = true;
      document.body.append(host);
      const className = `docx-${id.slice(0, 8)}`;
      await renderAsync(await res.blob(), host, host, {
        className,
        inWrapper: false,
        ignoreLastRenderedPageBreak: false,
      });
      const pages = [...host.querySelectorAll(`section.${className}`)];
      ready.set(id, pages);
      return pages;
    })();
    job.catch(() => jobs.delete(id));
    jobs.set(id, job);
  }
  return jobs.get(id);
}

function usePages(id) {
  const [state, setState] = useState(() => ({ pages: ready.get(id) ?? null, error: "" }));
  useEffect(() => {
    let live = true;
    renderFile(id).then(
      (pages) => live && setState({ pages, error: "" }),
      (err) => live && setState({ pages: null, error: err.message }),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return state;
}

/** A copy of one rendered page, sized by the `--z` of whatever holds it. */
function Page({ section }) {
  const box = useRef(null);
  useLayoutEffect(() => {
    box.current.replaceChildren(section.cloneNode(true));
  }, [section]);
  return <div className="docpage" ref={box} />;
}

const plural = (n) => `${n} page${n === 1 ? "" : "s"}`;
const fileUrl = (id, name) => `/api/chat/file/${id}?name=${encodeURIComponent(name)}`;

/** The file inside the message: name, the pages as a strip, and the way to the panel. */
export default function ProposalFile({ id, name, open, onOpen, onClose }) {
  const { pages, error } = usePages(id);
  const note = error || (pages ? `${plural(pages.length)} · ${open ? "open in the panel" : "swipe, or click a page"}` : "Loading the pages");
  return (
    <div className="docfile">
      <div className="dochead">
        <b>{name}</b>
        <span className="muted">{note}</span>
        <span className="docacts">
          <a className="choice icon" href={fileUrl(id, name)} download={name} title="Download" aria-label="Download">
            {DOWN}
          </a>
          {open ? (
            <button type="button" className="choice" onClick={onClose}>
              {SPLIT}Back to full view
            </button>
          ) : (
            <button type="button" className="choice" disabled={!pages} onClick={() => onOpen(0)}>
              {SPLIT}Open in side panel
            </button>
          )}
        </span>
      </div>
      {open || error ? null : (
        <div className="docstrip" style={{ "--z": 118 / PAGE_W }}>
          {(pages ?? [null, null, null, null]).map((section, i) => (
            <button key={i} type="button" disabled={!section} onClick={() => onOpen(i)} aria-label={`Page ${i + 1}`}>
              <span className="docthumb">{section ? <Page section={section} /> : null}</span>
              <small>{i + 1}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The whole document beside the thread, scrolled to `page`. */
export function DocPanel({ id, name, page, onClose }) {
  const { pages, error } = usePages(id);
  const body = useRef(null);

  // Readable width: the panel's, capped at 520px. Set on the element, not in
  // state, so a resize never re-renders the pages or moves the scroll.
  useLayoutEffect(() => {
    const el = body.current;
    const fit = () => el.style.setProperty("--z", Math.min(520, el.clientWidth - 40) / PAGE_W);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useLayoutEffect(() => {
    const target = body.current.children[page];
    if (target) body.current.scrollTop = target.offsetTop - 20;
  }, [page, pages]);

  return (
    <aside className="docpanel" aria-label={name}>
      <div className="docpanel-h">
        <span className="name">{name}</span>
        <span className="muted">{error || (pages ? plural(pages.length) : "Loading")}</span>
        <a className="choice icon ghost" href={fileUrl(id, name)} download={name} title="Download" aria-label="Download">
          {DOWN}
        </a>
        <button type="button" className="choice" onClick={onClose} title="Close (Esc)">
          {CLOSE}Close
        </button>
      </div>
      <div className="docpanel-b" ref={body}>
        {(pages ?? []).map((section, i) => (
          <figure key={i}>
            <Page section={section} />
            <figcaption>{i + 1}</figcaption>
          </figure>
        ))}
      </div>
    </aside>
  );
}
