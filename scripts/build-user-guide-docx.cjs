const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell,
  WidthType, ShadingType, AlignmentType, LevelFormat, PageBreak, TableOfContents, Header, Footer,
  PageNumber, BorderStyle, LineRuleType, ExternalHyperlink, VerticalAlign,
} = require('docx');

const DIR = path.join(__dirname, '..', 'docs', 'user-guide');
const OUT = process.argv[2] || path.join(DIR, 'CMS-Analytics-Studio-User-Guide.docx');
const md = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');

const FONT = 'Arial';
const RED = 'E11D48', INK = '1F2937', MUTED = '6B7280', ACCENT = '4F46E5';
const CONTENT_W = 9026; // A4 width 11906 - 2 x 1440 margins
const IMG_MAX_W = 600, IMG_MAX_H = 860; // px

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';
const uncircle = (s) => s.replace(/[①-⑩]/g, (c) => String(CIRCLED.indexOf(c) + 1));
// "Figure 7 → ⑥" -> "Figure 7, label 6"
const prose = (s) => uncircle(s.replace(/ → ([①-⑩])/g, ', label $1'));

// Inline markdown -> runs (bold, italic, code, links)
function runs(text, base = {}) {
  text = prose(text);
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, ...base }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', color: ACCENT, ...base }));
    else if (t.startsWith('[')) {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (/^https?:/.test(href)) out.push(new ExternalHyperlink({ link: href, children: [new TextRun({ text: label, style: 'Hyperlink', ...base })] }));
      else out.push(new TextRun({ text: label, bold: true, ...base }));
    } else out.push(new TextRun({ text: t.slice(1, -1), italics: true, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), data: b };
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
const borders = { top: border, bottom: border, left: border, right: border };

function table(rows) {
  const header = rows[0], body = rows.slice(1);
  const n = header.length;
  const numbered = header[0].trim() === '#';
  // Column widths: narrow number column, label column, wide description
  let widths;
  if (numbered && n === 3) widths = [700, 2600, CONTENT_W - 3300];
  else if (n === 2) widths = [2800, CONTENT_W - 2800];
  else if (n === 3) widths = [700, 4000, CONTENT_W - 4700];
  else widths = Array(n).fill(Math.floor(CONTENT_W / n));
  const cell = (text, i, isHead) => {
    const isNum = numbered && i === 0 && !isHead;
    return new TableCell({
      borders, width: { size: widths[i], type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      shading: isHead ? { fill: 'F3F4F6', type: ShadingType.CLEAR, color: 'auto' } : isNum ? { fill: RED, type: ShadingType.CLEAR, color: 'auto' } : undefined,
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      children: [new Paragraph({
        alignment: isNum ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: isNum ? [new TextRun({ text: uncircle(text.trim()), bold: true, color: 'FFFFFF', size: 22 })]
          : runs(text.trim(), isHead ? { bold: true, size: 20 } : { size: 20 }),
      })],
    });
  };
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: header.map((t, i) => cell(t, i, true)) }),
      ...body.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, false)) }))],
  });
}

const children = [];
const lines = md.split('\n');
let i = 0, firstH2 = true;
const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');

// Skip the README's own title/intro/contents: the cover page and Word TOC replace them.
while (i < lines.length && !lines[i].startsWith('## 1.')) i++;

while (i < lines.length) {
  const l = lines[i];
  if (!l.trim() || l.trim() === '---') { i++; continue; }
  if (l.startsWith('## ')) {
    if (!firstH2) children.push(new Paragraph({ children: [new PageBreak()] }));
    firstH2 = false;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(l.slice(3)) }));
    i++; continue;
  }
  if (l.startsWith('### ')) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(l.slice(4)) })); i++; continue; }
  const img = l.match(/^!\[[^\]]*\]\(([^)]+)\)/);
  if (img) {
    const { w, h, data } = pngSize(path.join(DIR, img[1]));
    let s = Math.min(IMG_MAX_W / w, IMG_MAX_H / h);
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60, line: 240, lineRule: LineRuleType.AUTO },
      children: [new ImageRun({ type: 'png', data, transformation: { width: Math.round(w * s), height: Math.round(h * s) } })] }));
    i++; continue;
  }
  if (/^\*Figure .*\*$/.test(l.trim())) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { after: 160 },
      children: [new TextRun({ text: prose(l.trim().slice(1, -1)), italics: true, color: MUTED, size: 19 })] }));
    i++; continue;
  }
  if (l.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) { if (!/^\|[\s:|-]+\|$/.test(lines[i].trim())) rows.push(splitRow(lines[i])); i++; }
    children.push(table(rows));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    continue;
  }
  if (l.startsWith('> ')) {
    children.push(new Paragraph({ shading: { fill: 'EEF2FF', type: ShadingType.CLEAR, color: 'auto' },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
      indent: { left: 200 }, spacing: { before: 120, after: 160 }, children: runs(l.slice(2)) }));
    i++; continue;
  }
  const num = l.match(/^\s*(\d+)\.\s+(.*)/);
  if (num) {
    const inst = i;
    while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
      const m2 = lines[i].match(/^\s*\d+\.\s+(.*)/);
      children.push(new Paragraph({ numbering: { reference: 'nums', level: 0, instance: inst }, children: runs(m2[1]) }));
      i++;
    }
    continue;
  }
  if (/^\s*[-*]\s+/.test(l)) { children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: runs(l.replace(/^\s*[-*]\s+/, '')) })); i++; continue; }
  children.push(new Paragraph({ spacing: { after: 140 }, children: runs(l) }));
  i++;
}

// Cover page
const cover = [
  new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: 'CMS Analytics Studio', bold: true, size: 64, color: ACCENT })] }),
  new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'User Guide', size: 44, color: INK })] }),
  new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: RED, space: 4 } }, spacing: { after: 360 }, children: [] }),
  new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'Instagram, Facebook, YouTube and LinkedIn analytics, cross-platform publishing and Instagram auto-replies in one place.', size: 24, color: INK })] }),
  new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'Web address: ', size: 24 }), new ExternalHyperlink({ link: 'https://cms.changtechs.com', children: [new TextRun({ text: 'https://cms.changtechs.com', style: 'Hyperlink', size: 24 })] })] }),
  new Paragraph({ spacing: { before: 600, after: 120 }, children: [new TextRun({ text: 'How to read this guide', bold: true, size: 24 })] }),
  new Paragraph({ children: [new TextRun({ text: 'Every screenshot has red numbered labels. The table under each screenshot explains what each number is and what to do with it. "Figure 7, label 6" means label number 6 in Figure 7.', size: 22, color: INK })] }),
  new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: 'A product of changtechs.com  ·  Version 1.0  ·  November 2026', size: 20, color: MUTED })] }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  new Paragraph({ children: [new PageBreak()] }),
];

const doc = new Document({
  creator: 'changtechs.com', title: 'CMS Analytics Studio — User Guide',
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FONT, size: 21, color: INK }, paragraph: { spacing: { after: 100, line: 276, lineRule: LineRuleType.AUTO } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 34, bold: true, color: ACCENT }, paragraph: { spacing: { before: 0, after: 200 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 26, bold: true, color: INK }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    { reference: 'nums', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } }, titlePage: true },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'CMS Analytics Studio — User Guide', size: 17, color: MUTED })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 17, color: MUTED })] })] }) },
    children: [...cover, ...children],
  }],
});

Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log('wrote', OUT, b.length); });
