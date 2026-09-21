import { readFileSync } from "fs";
import { join } from "path";
import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

const NAVY = "1A1A2E";
const MAGENTA = "E7004C";
const GREY = "777777";
const DARK = "222222";
const ANGLE = "F2F2F6";

export function plain(text) {
  return String(text ?? "")
    .replace(/\u2014/g, ", ")
    .replace(/\u2013/g, " to ")
    .replace(/\u2212/g, "-");
}

export function briefSlug(subject) {
  const slug = plain(subject).normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug.slice(0, 40) || "prospect";
}

function run(text, opts = {}) {
  return new TextRun({
    text: plain(text),
    font: "Arial",
    size: opts.size ?? 19,
    bold: !!opts.bold,
    color: opts.color ?? DARK,
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 80, line: 252 },
    children: [run(text, opts)],
  });
}

function heading(text) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    border: { bottom: { color: NAVY, space: 1, style: BorderStyle.SINGLE, size: 8 } },
    children: [run(text.toUpperCase(), { size: 21, bold: true, color: NAVY })],
  });
}

function logo() {
  try {
    const data = readFileSync(join(process.cwd(), "assets/qea_logo.png"));
    return new ImageRun({ type: "png", data, transformation: { width: 108, height: 29 } });
  } catch {
    return run("QEA Tech", { bold: true, color: NAVY, size: 21 });
  }
}

function angle(lines) {
  const edge = { style: BorderStyle.SINGLE, size: 8, color: NAVY };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 100, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, fill: ANGLE },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: { top: edge, bottom: edge, left: edge, right: edge },
        children: [
          para("QEA ANGLE", { size: 21, bold: true, color: MAGENTA, after: 60 }),
          ...lines.map((line) => para(`• ${line}`, { after: 40 })),
        ],
      })],
    })],
  });
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/** A short brief whose body is only the vault excerpts it was given. */
export async function buildBrief({ subject, hits }) {
  const children = [
    para("BUILDING INTELLIGENCE BRIEF", { size: 17, bold: true, color: MAGENTA, after: 40 }),
    para(subject, { size: 36, bold: true, color: NAVY, after: 40 }),
    para(`Prepared ${today()} from the published vault. Web research is not connected.`, {
      size: 17, color: GREY, after: 120,
    }),
    heading("What the vault says"),
  ];
  for (const hit of hits) {
    children.push(para(`${hit.path}: ${hit.heading}`, { size: 17, color: GREY, after: 40 }));
    if (hit.tier === "REFERENCE" || hit.tier === "UNLISTED") {
      children.push(para(`DO NOT QUOTE AS CURRENT. This page is ${hit.tier}.`, { size: 17, color: GREY }));
    }
    children.push(para(`Reported from ${hit.path}.`));
    children.push(para(hit.text));
  }
  children.push(heading("Not in this file"));
  children.push(para(
    "Live campaign counts are not copied here. If the vault states a count, Campaign HQ wins. Facts that are not in the excerpts above are not in this brief.",
  ));
  children.push(angle([
    `Opening line: we already have notes on ${subject}. Start from those, not from a guess.`,
    "Why now: only the excerpts above. If they do not name a reason to spend, say that.",
    "Proof: no logo claim and no savings figure was added. One that is not in the excerpts was left out.",
    "Next step: offer a scan only if the excerpts name a building this prospect controls.",
    "Door: not scored. The excerpts do not say how warm it is.",
  ]));

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1368, bottom: 864, left: 1080, right: 1080 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { color: NAVY, space: 1, style: BorderStyle.SINGLE, size: 6 } },
            children: [logo()],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              run("QEA Tech . Confidential . ", { size: 15, color: GREY }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 15, color: GREY }),
            ],
          })],
        }),
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
