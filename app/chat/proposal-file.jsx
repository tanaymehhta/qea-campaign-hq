"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { listPhotos } from "../../lib/docx-photos";

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
const PEN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
  </svg>
);
const PIN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);
const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const SOURCE = { satellite: "Satellite", streetview: "Street View", screenshot: "Your screenshot" };
const CLOSE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// One fetch and one render per file, shared by the strip, the photos and the
// panel. The finished file is also kept by id so the panel's first frame
// already has it, which is the frame the view transition snapshots.
const jobs = new Map();
const ready = new Map();
const hosts = new Map();
// Every mounted view of a file, so a new version reaches the strip, the
// photos and the panel at once.
const views = new Map();

/**
 * The newest version of the file's pages as docx-preview draws them, its
 * building photos, and which version it is. It
 * breaks only where the file says a page ends (manual breaks, and the breaks
 * Word recorded when it last laid the document out), so a page that
 * overflowed in Word is one long page here.
 */
function renderFile(id) {
  if (!jobs.has(id)) {
    const job = (async () => {
      const [{ renderAsync }, { default: JSZip }, res] = await Promise.all([
        import("docx-preview"),
        import("jszip"),
        fetch(`/api/chat/file/${id}?latest=1`),
      ]);
      if (!res.ok) throw new Error(res.status === 404 ? "File not found." : `Could not load the pages (${res.status}).`);
      // The styles docx-preview writes are global, scoped by this class name;
      // the host stays in the page, hidden, so they keep applying to the copies.
      const host = document.createElement("div");
      host.hidden = true;
      document.body.append(host);
      const className = `docx-${id.slice(0, 8)}`;
      const blob = await res.blob();
      await renderAsync(blob, host, host, {
        className,
        inWrapper: false,
        ignoreLastRenderedPageBreak: false,
      });
      const pages = [...host.querySelectorAll(`section.${className}`)];

      // docx-preview draws the body's pictures in document order, so the
      // photo's place among them finds its <img>. Trusted only when that image
      // has the photo's proportions; otherwise the photo has no page here.
      const zip = await JSZip.loadAsync(blob);
      const drawn = [...host.querySelectorAll(`section.${className} > article img`)];
      const photos = await Promise.all(
        (await listPhotos(zip)).map(async (photo) => {
          const img = drawn[photo.picture];
          const same = img && Math.abs(parseFloat(img.style.width) / parseFloat(img.style.height) - photo.cx / photo.cy) < 0.01;
          const section = same ? img.closest("section") : null;
          return {
            ...photo,
            src: URL.createObjectURL(await zip.file(photo.target).async("blob")),
            page: section ? pages.indexOf(section) : -1,
            // its place among the page's images, which a copy of the page keeps
            nth: section ? [...section.querySelectorAll("img")].indexOf(img) : -1,
          };
        }),
      );
      const at = res.headers.get("x-version-at");
      const version = {
        id: res.headers.get("x-version-id") ?? id,
        n: Number(res.headers.get("x-version") ?? 1),
        change: decodeURIComponent(res.headers.get("x-version-change") ?? ""),
        at: at ? new Date(at) : null,
      };
      // Every version renders under the same class names, so the new styles
      // already fit the old pages still on screen until React swaps them.
      hosts.get(id)?.remove();
      hosts.set(id, host);
      const file = { pages, photos, version };
      ready.set(id, file);
      return file;
    })();
    job.catch(() => jobs.delete(id));
    jobs.set(id, job);
  }
  return jobs.get(id);
}

function useFile(id) {
  const [state, setState] = useState(() => ({ ...ready.get(id), error: "" }));
  useEffect(() => {
    let live = true;
    const set = (next) => live && setState(next);
    if (!views.has(id)) views.set(id, new Set());
    views.get(id).add(set);
    renderFile(id).then(
      (file) => set({ ...file, error: "" }),
      (err) => set({ error: err.message }),
    );
    return () => {
      live = false;
      views.get(id).delete(set);
    };
  }, [id]);
  return state;
}

/** Fetch and draw the newest version again; every view keeps the old one until it lands. */
function reloadFile(id) {
  jobs.delete(id);
  const job = renderFile(id);
  return job.then((file) => {
    for (const set of views.get(id) ?? []) set({ ...file, error: "" });
  });
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
const maps = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

function ago(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// The app's own date format and time zone, as prettyWhen writes them on /files.
const when = (iso) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

/**
 * "v3 · Photo 1 replaced · 2 min ago", and behind it every version of the
 * document with its own download. Read when opened, so it is never stale.
 */
function Versions({ id, name, version }) {
  const [list, setList] = useState(null);
  return (
    <details
      className="docver"
      onToggle={(e) => {
        if (!e.currentTarget.open) return;
        fetch(`/api/chat/file/${id}/versions`)
          .then((res) => (res.ok ? res.json() : []))
          .then(setList, () => setList([]));
      }}
    >
      <summary>
        v{version.n} · {version.change}
        {version.at ? ` · ${ago(version.at)}` : ""} · Earlier versions
      </summary>
      <div className="menu">
        {list
          ? list
              .map((v, i) => (
                <a key={v.id} href={fileUrl(v.id, name)} download={name} className={v.id === version.id ? "on" : ""}>
                  {DOWN}
                  <span>
                    v{i + 1} · {v.change}
                  </span>
                  <small>{v.id === version.id ? "open now" : when(v.created_at)}</small>
                </a>
              ))
              .reverse()
          : <span className="muted">Loading</span>}
      </div>
    </details>
  );
}

// Vercel refuses request bodies over 4.5 MB; the route takes 4 MB.
const MAX_UPLOAD = 4 * 1024 * 1024;

/**
 * Any image the browser can read, as a real PNG (the photo's part in the
 * .docx is a .png) no longer than 2000 px on its longest side, and smaller
 * again if a photographic screenshot is still over the upload limit.
 */
async function toPng(file) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Could not read that image. Try a PNG or JPEG screenshot.");
  });
  for (const side of [2000, 1600, 1200]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((done) => canvas.toBlob(done, "image/png"));
    if (png && png.size <= MAX_UPLOAD) return png;
  }
  throw new Error("That image is too large. Try a smaller screenshot.");
}

/**
 * Replace a photo: paste, drop, or choose an image. Anchored to the Edit
 * button that opened it, and closed by Esc, Cancel, or a click outside,
 * except while it is saving.
 */
function EditPhoto({ photo, n, anchor, onSave, onClose }) {
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const busyRef = useRef(false);

  // Under the button, or above it when there is no room below.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = box.current.offsetHeight;
    setPos({
      left: Math.min(Math.max(8, r.right - 320), innerWidth - 328),
      top: r.bottom + 8 + h > innerHeight ? Math.max(8, r.top - 8 - h) : r.bottom + 8,
    });
  }, [anchor]);

  async function take(file) {
    if (busyRef.current || !file) return;
    if (!file.type.startsWith("image/")) return setError("That is not an image.");
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(await toPng(file));
    } catch (err) {
      setError(err.message);
      busyRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const paste = (e) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      take(item.getAsFile());
    };
    // Capture, and stop it there, so Esc closes this and not the side panel too.
    const key = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!busyRef.current) onClose();
    };
    const down = (e) => {
      if (!busyRef.current && !box.current.contains(e.target) && !anchor.contains(e.target)) onClose();
    };
    document.addEventListener("paste", paste);
    window.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("paste", paste);
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", down);
    };
  });

  return createPortal(
    <div className="pop" ref={box} role="dialog" aria-label={`Edit photo ${n}`} style={pos ?? { visibility: "hidden" }}>
      <div className="row">
        <b>Edit photo {n}</b>
        <button type="button" className="choice icon ghost" onClick={onClose} disabled={busy} aria-label="Close">
          {CLOSE}
        </button>
      </div>
      {photo.address ? (
        <a className="maplink" href={maps(photo.address)} target="_blank" rel="noopener">
          {PIN}
          {photo.address}
        </a>
      ) : (
        <span className="noaddr">Address not recorded</span>
      )}
      <div
        className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files[0]);
        }}
      >
        {busy ? (
          "Saving…"
        ) : (
          <>
            Paste a screenshot with <kbd>⌘V</kbd>
            <br />
            or <b>drop an image here</b>
          </>
        )}
      </div>
      {error ? <p className="err">{error}</p> : <p className="hint">Open the address in Maps, screenshot the building, paste.</p>}
      <div className="row">
        <label className={`choice${busy ? " off" : ""}`}>
          Choose file
          <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => take(e.target.files[0])} />
        </label>
        <button type="button" className="choice ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Outline the photo on its page in the open panel, and bring it into view there. */
function outline(id, photo, on) {
  const body = document.querySelector(`.docpanel[data-id="${id}"] .docpanel-b`);
  const img = body?.children[photo.page]?.querySelectorAll("img")[photo.nth];
  if (!img) return;
  img.classList.toggle("hl", on);
  if (!on) return;
  const box = body.getBoundingClientRect();
  const at = img.getBoundingClientRect();
  body.scrollBy({ top: at.top - box.top - (box.height - at.height) / 2, behavior: "smooth" });
}

/**
 * One photo as large as the screen allows. A native modal dialog, so it sits
 * above everything and takes focus; Esc, Close, or a click anywhere but the
 * header closes it.
 */
function Lightbox({ photo, n, onClose }) {
  const box = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const dialog = box.current;
    dialog.showModal();
    dialog.querySelector(".lightbox-h .choice").focus();
    // Esc would also reach the chat's own Esc and close the side panel.
    const key = (e) => e.key === "Escape" && e.stopPropagation();
    // The browser would close it at once; closing through onClose animates it.
    const cancel = (e) => {
      e.preventDefault();
      close.current();
    };
    dialog.addEventListener("keydown", key);
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("keydown", key);
      dialog.removeEventListener("cancel", cancel);
    };
  }, []);
  const meta = [SOURCE[photo.source], photo.page >= 0 ? `page ${photo.page + 1}` : null].filter(Boolean).join(" · ");
  return (
    <dialog
      ref={box}
      className="lightbox"
      aria-label={`Photo ${n}`}
      onClick={(e) => {
        if (!e.target.closest(".lightbox-h")) onClose();
      }}
    >
      <div className="lightbox-h">
        <div>
          {photo.address ? (
            <a className="maplink" href={maps(photo.address)} target="_blank" rel="noopener">
              {PIN}
              {photo.address}
            </a>
          ) : (
            <span className="noaddr">Address not recorded</span>
          )}
          {meta ? <div className="muted">{meta}</div> : null}
        </div>
        <button type="button" className="choice" onClick={onClose} title="Close (Esc)">
          {CLOSE}Close
        </button>
      </div>
      <img src={photo.src} alt={`Photo ${n}`} />
    </dialog>
  );
}

/**
 * One building photo: big in the message, a compact row while the panel is
 * open. Clicking the image shows it full screen.
 */
function Photo({ id, photo, n, mini, checked, onCheck, onEdit, onExpand }) {
  const meta = [SOURCE[photo.source], photo.page >= 0 ? `page ${photo.page + 1}` : null].filter(Boolean).join(" · ");
  return (
    <div
      className={`bigphoto${mini ? " mini" : ""}`}
      style={{ viewTransitionName: `photo-${id.slice(0, 8)}-${photo.rel}` }}
      onMouseEnter={mini ? () => outline(id, photo, true) : undefined}
      onMouseLeave={mini ? () => outline(id, photo, false) : undefined}
    >
      <div className="imgwrap">
        <img src={photo.src} alt={`Photo ${n}`} onClick={(e) => onExpand(e.currentTarget)} />
        {mini ? <span className="num">{n}</span> : null}
        <button type="button" className="edit" title="Replace this photo" aria-label={`Edit photo ${n}`} onClick={onEdit}>
          {PEN}
          {mini ? null : "Edit"}
        </button>
      </div>
      <div className="body">
        <div>
          {photo.address ? (
            <a className="maplink" href={maps(photo.address)} target="_blank" rel="noopener">
              {PIN}
              {photo.address}
            </a>
          ) : (
            <span className="noaddr">Address not recorded</span>
          )}
          {meta ? <div className="muted">{meta}</div> : null}
        </div>
        <div className="acts">
          <span className={`tag${checked ? " ok" : ""}`}>{checked ? "Checked" : "Not checked"}</span>
          <button type="button" className={`choice ${checked ? "on-ok" : "ok"}`} aria-pressed={checked} onClick={onCheck}>
            {CHECK}Looks right
          </button>
        </div>
      </div>
    </div>
  );
}

/** The file inside the message: name, the pages as a strip, and the way to the panel. */
export default function ProposalFile({ id, name, open, onOpen, onClose }) {
  const { pages, photos, version, error } = useFile(id);
  // Which photos the rep has looked at. Kept on this screen only for now.
  const [checked, setChecked] = useState(() => new Set());
  const check = (rel) =>
    setChecked((was) => {
      const next = new Set(was);
      if (!next.delete(rel)) next.add(rel);
      return next;
    });
  // The photo being replaced, and the Edit button its popover hangs from.
  const [editing, setEditing] = useState(null);
  useEffect(() => setEditing(null), [open]);

  // The photo shown full screen, and the card image it grows out of: the two
  // share a view-transition name for the length of the morph, never both at once.
  const [big, setBig] = useState(null);
  function expand(photo, n, img) {
    const show = () => flushSync(() => setBig({ photo, n, img }));
    if (!document.startViewTransition) return show();
    img.style.viewTransitionName = "bigphoto";
    document.startViewTransition(() => {
      img.style.viewTransitionName = "";
      show();
    });
  }
  function shrink() {
    const img = big?.img;
    const hide = () => flushSync(() => setBig(null));
    if (!document.startViewTransition || !img?.isConnected) return hide();
    const morph = document.startViewTransition(() => {
      hide();
      img.style.viewTransitionName = "bigphoto";
    });
    morph.finished.finally(() => {
      img.style.viewTransitionName = "";
    });
  }

  async function save(photo, png) {
    const form = new FormData();
    form.append("rel", photo.rel);
    form.append("image", png, "photo.png");
    const res = await fetch(`/api/chat/file/${id}/photo`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Could not save the photo (${res.status}).`);
    await reloadFile(id);
    // A new picture has not been looked at yet.
    setChecked((was) => {
      const next = new Set(was);
      next.delete(photo.rel);
      return next;
    });
    setEditing(null);
  }
  const url = fileUrl(version?.id ?? id, name);
  const note = error || (pages ? `${plural(pages.length)} · ${open ? "open in the panel" : "swipe, or click a page"}` : "Loading the pages");
  return (
    <div className="docfile">
      <div className="dochead">
        <b>{name}</b>
        <span className="muted">{note}</span>
        <span className="docacts">
          <a className="choice icon" href={url} download={name} title="Download" aria-label="Download">
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
      {photos?.length ? (
        <>
          <span className="lbl">Photos in this proposal</span>
          <div className={`photos${open ? "" : " grid"}`}>
            {photos.map((photo, i) => (
              <Photo
                key={photo.rel}
                id={id}
                photo={photo}
                n={i + 1}
                mini={open}
                checked={checked.has(photo.rel)}
                onCheck={() => check(photo.rel)}
                onEdit={(e) => setEditing({ photo, n: i + 1, anchor: e.currentTarget })}
                onExpand={(img) => expand(photo, i + 1, img)}
              />
            ))}
          </div>
        </>
      ) : null}
      {version?.n > 1 ? <Versions id={id} name={name} version={version} /> : null}
      {big ? <Lightbox photo={big.photo} n={big.n} onClose={shrink} /> : null}
      {editing ? (
        <EditPhoto
          key={editing.photo.rel}
          {...editing}
          onSave={(png) => save(editing.photo, png)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/** The whole document beside the thread, scrolled to `page`. */
export function DocPanel({ id, name, page, onClose }) {
  const { pages, version, error } = useFile(id);
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

  // On the page asked for, and only then: a new version arriving keeps the scroll.
  useLayoutEffect(() => {
    const target = body.current.children[page];
    if (target) body.current.scrollTop = target.offsetTop - 20;
  }, [page]);

  return (
    <aside className="docpanel" data-id={id} aria-label={name}>
      <div className="docpanel-h">
        <span className="name">{name}</span>
        <span className="muted">{error || (pages ? plural(pages.length) : "Loading")}</span>
        <a className="choice icon ghost" href={fileUrl(version?.id ?? id, name)} download={name} title="Download" aria-label="Download">
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
