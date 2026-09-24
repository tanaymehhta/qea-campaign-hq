import JSZip from "jszip";

// A .docx is a zip. A building photo is one image part, reached from one
// <w:drawing> through a relationship id starting "rIdProp" (rIdProp, rIdProp2,
// ...). Logos and every other picture use other ids and are never touched.
//
// Regex rather than an XML parser, on purpose: each match is scoped to one
// <w:drawing>...</w:drawing> (or one <w:p> for the address fallback), and a
// parse-and-serialise round trip would rewrite every byte of document.xml when
// an edit is only allowed to change one drawing.

const DOC = "word/document.xml";
const RELS = "word/_rels/document.xml.rels";
const DRAWING = /<w:drawing>[\s\S]*?<\/w:drawing>/g;
const PHOTO_REL = /<a:blip\b[^>]*\br:embed="(rIdProp\d*)"/;
// The template's own alt text on the photo, which says nothing about the building.
const STOCK_DESCR = /^An aerial view of a building/;
// The paragraphs the template prints above the photo, by their fixed w14:paraId.
// The service deletes one when its value is blank, so the address can be in
// either: PROPERTY_ADDRESS first, then PROPERTY_NAME.
const ADDRESS_PARAS = ["692BE70D", "24739DD2"];
// Width of the photo box, and the most height it may take, in EMU, exactly as
// the proposal service sizes it (fill_proposal.py): 6.0 in wide, 7.5 in tall at most.
const BOX_CX = 5486400;
const MAX_CY = 6858000;

const unescape = (s) =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e]);
const escape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unescape(m[1]) : null;
};
const textOf = (xml) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unescape(m[1])).join("").trim();

async function open(docx) {
  const zip = docx instanceof JSZip ? docx : await JSZip.loadAsync(docx);
  const doc = await zip.file(DOC).async("string");
  const rels = await zip.file(RELS).async("string");
  const targets = {};
  for (const [tag] of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const target = attr(tag, "Target");
    targets[attr(tag, "Id")] = target.startsWith("/") ? target.slice(1) : `word/${target}`;
  }
  return { zip, doc, targets };
}

/** The address the file already states for the photo drawn at `at`, or null. */
function paragraphAddress(doc, at) {
  const before = doc.slice(0, at);
  for (const id of ADDRESS_PARAS) {
    const paras = [...before.matchAll(new RegExp(`<w:p\\b[^>]*w14:paraId="${id}"[^>]*>[\\s\\S]*?</w:p>`, "g"))];
    const text = paras.length ? textOf(paras[paras.length - 1][0]) : "";
    if (text) return text;
  }
  return null;
}

/**
 * Every building photo in the document, in document order. `picture` is the
 * photo's position among all the document body's pictures (pic:pic), which is
 * how a renderer that draws them in order can find it again.
 */
export async function listPhotos(docx) {
  const { doc, targets } = await open(docx);
  const photos = [];
  for (const m of doc.matchAll(DRAWING)) {
    const drawing = m[0];
    const rel = drawing.match(PHOTO_REL)?.[1];
    if (!rel) continue;
    const docPr = drawing.match(/<wp:docPr\b[^>]*>/)?.[0] ?? "";
    const extent = drawing.match(/<wp:extent\b[^>]*>/)?.[0] ?? "";
    const descr = attr(docPr, "descr")?.trim();
    const title = attr(docPr, "title") ?? "";
    photos.push({
      rel,
      target: targets[rel] ?? null,
      address: descr && !STOCK_DESCR.test(descr) ? descr : paragraphAddress(doc, m.index),
      source: title.startsWith("source:") ? title.slice(7) || null : null,
      cx: Number(attr(extent, "cx")),
      cy: Number(attr(extent, "cy")),
      picture: (doc.slice(0, m.index).match(/<pic:pic\b/g) ?? []).length,
    });
  }
  return photos;
}

/** The photo box for an image of this size: the service's rule, to the EMU. */
export function photoBox(width, height) {
  let cx = BOX_CX;
  let cy = Math.floor((cx * height) / width);
  if (cy > MAX_CY) {
    cy = MAX_CY;
    cx = Math.floor((MAX_CY * width) / height);
  }
  return { cx, cy };
}

/**
 * A new .docx with the one image behind `rel` replaced by `png` and its box
 * resized to the image's proportions. Every other part is carried over
 * unchanged, and in document.xml only that drawing's tags change.
 */
export async function replacePhoto(docx, rel, png, { width, height }) {
  if (!/^rIdProp\d*$/.test(rel)) throw new Error(`Not a building photo: ${rel}`);
  const { zip, doc, targets } = await open(docx);
  const target = targets[rel];
  if (!target || !zip.file(target)) throw new Error(`No image behind ${rel}`);
  // The service always writes the photo as PNG; a different extension would
  // need a new part name and a content type, which no file has needed.
  if (!target.endsWith(".png")) throw new Error(`Photo ${rel} is not a PNG part: ${target}`);

  const { cx, cy } = photoBox(width, height);
  let found = false;
  const next = doc.replace(DRAWING, (drawing) => {
    if (drawing.match(PHOTO_REL)?.[1] !== rel) return drawing;
    found = true;
    return drawing
      .replace(/<(wp:extent|a:ext)\b[^>]*>/g, (tag) =>
        tag.includes(' cx="') ? tag.replace(/ cx="\d+"/, ` cx="${cx}"`).replace(/ cy="\d+"/, ` cy="${cy}"`) : tag,
      )
      .replace(/<wp:docPr\b[^>]*>/, (tag) => {
        const title = ` title="${escape("source:screenshot")}"`;
        return / title="[^"]*"/.test(tag) ? tag.replace(/ title="[^"]*"/, title) : tag.replace(/<wp:docPr\b/, `$&${title}`);
      });
  });
  if (!found) throw new Error(`No drawing uses ${rel}`);

  zip.file(target, png);
  zip.file(DOC, next);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
