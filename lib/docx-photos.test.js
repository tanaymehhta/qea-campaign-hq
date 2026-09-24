import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { listPhotos, photoBox, replacePhoto } from "./docx-photos.js";

// The shapes the proposal template uses: the photo is an inline drawing whose
// blip points at rIdProp, with the address paragraphs above it.
const drawing = (rel, descr, cx = 5486400, cy = 3657600, lead = "") => `<w:p><w:r>${lead}<w:drawing>
  <wp:inline><wp:extent cx="${cx}" cy="${cy}"/>
    <wp:docPr id="1" name="Picture" descr="${descr}"><a:extLst><a:ext uri="{X}" cx="${cx}" cy="${cy}"/></a:extLst></wp:docPr>
    <a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rel}"/></pic:blipFill>
      <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic>
  </wp:inline></w:drawing></w:r></w:p>`;
// The red box the template draws over the photo, and a shape that is not one.
const RED_BOX = `<mc:AlternateContent><mc:Choice Requires="wps"></mc:Choice><mc:Fallback><w:pict><v:rect id="Rectangle 13" strokecolor="#c00000"/></w:pict></mc:Fallback></mc:AlternateContent>`;
const OTHER = `<mc:AlternateContent><mc:Fallback><w:pict><v:oval/></w:pict></mc:Fallback></mc:AlternateContent>`;
const para = (id, text) => `<w:p w14:paraId="${id}"><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const DOCUMENT = `<?xml version="1.0"?><w:document><w:body>
${drawing("rIdLogo", "QEA logo", 900000, 300000)}
${para("24739DD2", "Science Center")}
${para("692BE70D", "1 Oxford St, Cambridge, MA &amp; annex")}
${drawing("rIdProp", "An aerial view of a building and parking lot  AI-generated content may be incorrect.", 5486400, 3657600, OTHER + RED_BOX)}
${drawing("rIdProp2", "100 South Campus Drive, Allston, MA")}
</w:body></w:document>`;
const RELS = `<?xml version="1.0"?><Relationships>
<Relationship Id="rIdLogo" Type="image" Target="media/logo.png"/>
<Relationship Id="rIdProp" Type="image" Target="media/property_photo.png"/>
<Relationship Id="rIdProp2" Type="image" Target="media/property_photo2.png"/>
</Relationships>`;

async function fixture() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types><Default Extension="png" ContentType="image/png"/></Types>');
  zip.file("word/document.xml", DOCUMENT);
  zip.file("word/_rels/document.xml.rels", RELS);
  zip.file("word/media/logo.png", "LOGO");
  zip.file("word/media/property_photo.png", "PHOTO-1");
  zip.file("word/media/property_photo2.png", "PHOTO-2");
  return zip.generateAsync({ type: "uint8array" });
}

test("lists the building photos in order, and never the logo", async () => {
  const photos = await listPhotos(await fixture());
  assert.deepEqual(photos.map((p) => [p.rel, p.target, p.picture]), [
    ["rIdProp", "word/media/property_photo.png", 1],
    ["rIdProp2", "word/media/property_photo2.png", 2],
  ]);
});

test("the address comes from the alt text, or from the address paragraph when the alt text is the template's", async () => {
  const [first, second] = await listPhotos(await fixture());
  assert.equal(first.address, "1 Oxford St, Cambridge, MA & annex");
  assert.equal(second.address, "100 South Campus Drive, Allston, MA");
  assert.equal(first.source, null);
});

test("with the address paragraph removed, the name paragraph above it is the address", async () => {
  const zip = await JSZip.loadAsync(await fixture());
  zip.file("word/document.xml", DOCUMENT.replace(para("692BE70D", "1 Oxford St, Cambridge, MA &amp; annex"), ""));
  const [first] = await listPhotos(zip);
  assert.equal(first.address, "Science Center");
});

test("a portrait photo hits the 7.5 inch clamp, like the service", () => {
  assert.deepEqual(photoBox(1600, 1000), { cx: 5486400, cy: 3429000 });
  assert.deepEqual(photoBox(1000, 2000), { cx: 3429000, cy: 6858000 });
});

test("replacing one photo changes that image and that drawing, and nothing else", async () => {
  const before = await JSZip.loadAsync(await fixture());
  const after = await JSZip.loadAsync(await replacePhoto(await fixture(), "rIdProp", new Uint8Array([1, 2, 3]), { width: 1000, height: 2000 }));

  assert.deepEqual([...(await after.file("word/media/property_photo.png").async("uint8array"))], [1, 2, 3]);
  for (const name of ["[Content_Types].xml", "word/_rels/document.xml.rels", "word/media/logo.png", "word/media/property_photo2.png"]) {
    assert.equal(await after.file(name).async("string"), await before.file(name).async("string"), name);
  }

  const doc = await after.file("word/document.xml").async("string");
  const drawings = doc.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g);
  assert.equal(drawings.length, 3);
  assert.ok(DOCUMENT.includes(drawings[0]), "logo untouched");
  assert.ok(DOCUMENT.includes(drawings[2]), "the other photo untouched");
  assert.equal((drawings[1].match(/cx="3429000" cy="6858000"/g) ?? []).length, 3);
  assert.ok(!drawings[1].includes("5486400"));
  assert.match(drawings[1], /<wp:docPr title="source:screenshot" id="1"/);
  assert.ok(doc.startsWith(DOCUMENT.slice(0, DOCUMENT.indexOf("<mc:AlternateContent>"))));
  assert.ok(!doc.includes("<v:rect"), "the red box is gone");
  assert.ok(doc.includes(OTHER), "any other shape stays");

  const [first] = await listPhotos(after);
  assert.deepEqual([first.cx, first.cy, first.source], [3429000, 6858000, "screenshot"]);
});

test("refuses anything that is not a building photo", async () => {
  await assert.rejects(replacePhoto(await fixture(), "rIdLogo", new Uint8Array(), { width: 1, height: 1 }), /Not a building photo/);
  await assert.rejects(replacePhoto(await fixture(), "rIdProp9", new Uint8Array(), { width: 1, height: 1 }), /No image behind/);
});
