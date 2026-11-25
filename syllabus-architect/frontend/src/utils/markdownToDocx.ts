import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  convertInchesToTwip,
} from 'docx';

interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function parseInlineFormatting(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push({ text: match[2], bold: true, italic: true });
    } else if (match[3]) {
      runs.push({ text: match[3], bold: true });
    } else if (match[4]) {
      runs.push({ text: match[4], italic: true });
    } else if (match[5]) {
      runs.push({ text: match[5], bold: true });
    } else if (match[6]) {
      runs.push({ text: match[6] });
    }
  }
  if (runs.length === 0 && text) {
    runs.push({ text });
  }
  return runs;
}

function makeTextRuns(
  text: string,
  baseOpts?: { bold?: boolean; size?: number; color?: string }
): TextRun[] {
  const inlines = parseInlineFormatting(text);
  return inlines.map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold || baseOpts?.bold || false,
        italics: r.italic || false,
        size: baseOpts?.size || 22,
        color: baseOpts?.color || '333333',
        font: 'Calibri',
      })
  );
}

function buildTableFromLines(headerLine: string, separatorLine: string, bodyLines: string[]): Table {
  const parseCells = (line: string): string[] =>
    line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c !== '');

  const alignments = separatorLine
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c !== '')
    .map((c) => {
      if (c.startsWith(':') && c.endsWith(':')) return AlignmentType.CENTER;
      if (c.endsWith(':')) return AlignmentType.RIGHT;
      return AlignmentType.LEFT;
    });

  const headerCells = parseCells(headerLine);
  const colCount = headerCells.length;

  const makeRow = (cells: string[], isHeader: boolean): TableRow => {
    const padded = [...cells];
    while (padded.length < colCount) padded.push('');

    return new TableRow({
      tableHeader: isHeader,
      children: padded.slice(0, colCount).map(
        (cell, i) =>
          new TableCell({
            width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
            shading: isHeader
              ? { type: ShadingType.SOLID, color: '1A1A1A', fill: '1A1A1A' }
              : undefined,
            children: [
              new Paragraph({
                alignment: alignments[i] || AlignmentType.LEFT,
                spacing: { before: 40, after: 40 },
                children: makeTextRuns(cell, {
                  bold: isHeader,
                  size: 20,
                  color: isHeader ? 'FFFFFF' : '333333',
                }),
              }),
            ],
          })
      ),
    });
  };

  const headerRow = makeRow(headerCells, true);
  const bodyRows = bodyLines.map((line) => makeRow(parseCells(line), false));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
    },
  });
}

export function markdownToDocxChildren(markdown: string): (Paragraph | Table)[] {
  const lines = markdown.split('\n');
  const children: (Paragraph | Table)[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Table detection: a line with pipes followed by a separator line
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\|?\s*[-:]+[-|:\s]+$/.test(lines[i + 1].trim())
    ) {
      const headerLine = line;
      const separatorLine = lines[i + 1];
      const bodyLines: string[] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        bodyLines.push(lines[i]);
        i++;
      }
      children.push(buildTableFromLines(headerLine, separatorLine, bodyLines));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      continue;
    }

    // Headings
    const h1Match = line.match(/^#\s+(.+)/);
    const h2Match = line.match(/^##\s+(.+)/);
    const h3Match = line.match(/^###\s+(.+)/);
    const h4Match = line.match(/^####\s+(.+)/);

    if (h1Match) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 200 },
          children: [
            new TextRun({
              text: h1Match[1],
              bold: true,
              size: 36,
              color: '1A1A1A',
              font: 'Calibri',
            }),
          ],
        })
      );
      i++;
      continue;
    }
    if (h2Match) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 160 },
          children: [
            new TextRun({
              text: h2Match[1],
              bold: true,
              size: 28,
              color: '1A1A1A',
              font: 'Calibri',
            }),
          ],
        })
      );
      i++;
      continue;
    }
    if (h3Match) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 },
          children: [
            new TextRun({
              text: h3Match[1],
              bold: true,
              size: 24,
              color: '333333',
              font: 'Calibri',
            }),
          ],
        })
      );
      i++;
      continue;
    }
    if (h4Match) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_4,
          spacing: { before: 200, after: 100 },
          children: [
            new TextRun({
              text: h4Match[1],
              bold: true,
              size: 22,
              color: '555555',
              font: 'Calibri',
            }),
          ],
        })
      );
      i++;
      continue;
    }

    // Bullet points (- or *)
    const bulletMatch = line.match(/^(\s*)[*-]\s+(.+)/);
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      children.push(
        new Paragraph({
          bullet: { level: indent },
          spacing: { after: 60 },
          children: makeTextRuns(bulletMatch[2]),
        })
      );
      i++;
      continue;
    }

    // Numbered lists
    const numberedMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (numberedMatch) {
      const indent = Math.floor(numberedMatch[1].length / 3);
      children.push(
        new Paragraph({
          bullet: { level: indent },
          spacing: { after: 60 },
          children: makeTextRuns(numberedMatch[2]),
        })
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
          children: [],
        })
      );
      i++;
      continue;
    }

    // Regular paragraph
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: makeTextRuns(line),
      })
    );
    i++;
  }

  return children;
}

export function buildDocxFromMarkdown(markdown: string): Document {
  return new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: '333333' },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: [
          new Paragraph({
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: 'Syllabus Architect — Comparative Analysis',
                bold: true,
                size: 40,
                color: '1A1A1A',
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 200 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'D4D4D8' } },
            children: [
              new TextRun({
                text: `Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
                size: 20,
                color: '6B7280',
                font: 'Calibri',
              }),
            ],
          }),
          ...markdownToDocxChildren(markdown),
        ],
      },
    ],
  });
}
