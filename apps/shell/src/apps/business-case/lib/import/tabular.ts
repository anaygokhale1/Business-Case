/**
 * Turning an uploaded file into a grid of strings.
 *
 * Two formats: .xlsx via the ZIP reader, and CSV. Both land on the same `Sheet`
 * shape, so everything downstream — header detection, mapping, the match report —
 * is written once against that and does not know which it came from.
 */

import { readZipText, ZipError } from "./zip";

export interface Sheet {
  name: string;
  /** Row-major, ragged edges padded so every row is the same length. */
  rows: string[][];
}

export class ImportError extends Error {}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * RFC 4180 with the usual concessions: quoted fields may contain the delimiter,
 * newlines and doubled quotes.
 *
 * Hand-written rather than a regex split, because a regex cannot track whether it is
 * inside a quoted field and a quoted address containing a comma is entirely normal in
 * a real export.
 */
export const parseCsv = (text: string, delimiter = ","): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  // Strip a UTF-8 BOM, which Excel writes and which would otherwise become part of
  // the first header name and stop it matching anything.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < source.length) {
    const char = source[i]!;

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Treat CRLF and a lone CR as one line ending.
      endRow();
      i += source[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return pad(rows);
};

/** Guess the delimiter from the header line. Semicolons are standard in European exports. */
export const guessDelimiter = (text: string): string => {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t", "|"].map((d) => ({
    d,
    n: firstLine.split(d).length - 1,
  }));
  const best = counts.reduce((a, b) => (b.n > a.n ? b : a));
  return best.n === 0 ? "," : best.d;
};

const pad = (rows: string[][]): string[][] => {
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return rows.map((r) => (r.length === width ? r : [...r, ...Array(width - r.length).fill("")]));
};

/* -------------------------------------------------------------------------- */
/* XLSX                                                                       */
/* -------------------------------------------------------------------------- */

const RELS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** "BC" -> 54. Column letters are base-26 with no zero. */
export const columnIndex = (ref: string): number => {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1] ?? "A";
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
};

const parseXml = (xml: string, what: string): Document => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new ImportError(`Could not read ${what} — the file's XML is malformed.`);
  }
  return doc;
};

/** The shared string table. Cells of type "s" hold an index into this. */
const readSharedStrings = (xml: string | undefined): string[] => {
  if (!xml) return [];
  const doc = parseXml(xml, "the shared string table");
  return Array.from(doc.getElementsByTagName("si")).map((si) =>
    // A single string may be split across several runs by formatting, so every <t>
    // inside the entry is concatenated. Taking only the first would truncate any
    // header that happens to have a bold word in it.
    Array.from(si.getElementsByTagName("t"))
      .map((t) => t.textContent ?? "")
      .join(""),
  );
};

const readSheetRows = (xml: string, shared: string[]): string[][] => {
  const doc = parseXml(xml, "a worksheet");
  const out: string[][] = [];

  for (const rowEl of Array.from(doc.getElementsByTagName("row"))) {
    const cells: string[] = [];
    for (const cellEl of Array.from(rowEl.getElementsByTagName("c"))) {
      const index = columnIndex(cellEl.getAttribute("r") ?? "A");
      const type = cellEl.getAttribute("t");

      let text = "";
      if (type === "inlineStr") {
        text = Array.from(cellEl.getElementsByTagName("t"))
          .map((t) => t.textContent ?? "")
          .join("");
      } else {
        const raw = cellEl.getElementsByTagName("v")[0]?.textContent ?? "";
        if (type === "s") {
          text = shared[Number(raw)] ?? "";
        } else if (type === "e") {
          // An error cell (#DIV/0!, #REF!) is carried through as its text so the
          // import report can say a cell is broken rather than reading it as blank.
          text = raw;
        } else {
          text = raw;
        }
      }

      while (cells.length < index) cells.push("");
      cells[index] = text;
    }
    out.push(cells);
  }

  return pad(out);
};

/** Sheet name -> part path, via the workbook and its relationships. */
const readSheetIndex = (
  workbookXml: string,
  relsXml: string | undefined,
): Array<{ name: string; path: string }> => {
  const workbook = parseXml(workbookXml, "the workbook");
  const rels = new Map<string, string>();

  if (relsXml) {
    for (const rel of Array.from(parseXml(relsXml, "the workbook relationships").getElementsByTagName("Relationship"))) {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target) rels.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
  }

  return Array.from(workbook.getElementsByTagName("sheet")).flatMap((sheet, i) => {
    const name = sheet.getAttribute("name") ?? `Sheet${i + 1}`;
    const relId = sheet.getAttributeNS(RELS_NS, "id") ?? sheet.getAttribute("r:id");
    const target = relId ? rels.get(relId) : undefined;
    // Falling back to positional naming rather than dropping the sheet: a workbook
    // with unusual relationships should still be readable.
    return [{ name, path: `xl/${target ?? `worksheets/sheet${i + 1}.xml`}` }];
  });
};

export const readXlsx = async (buffer: ArrayBuffer): Promise<Sheet[]> => {
  let parts: Map<string, string>;
  try {
    parts = await readZipText(
      buffer,
      (name) =>
        name === "xl/workbook.xml" ||
        name === "xl/_rels/workbook.xml.rels" ||
        name === "xl/sharedStrings.xml" ||
        name.startsWith("xl/worksheets/"),
    );
  } catch (error) {
    throw new ImportError(
      error instanceof ZipError ? error.message : "Could not open the file as a workbook.",
    );
  }

  const workbookXml = parts.get("xl/workbook.xml");
  if (!workbookXml) {
    throw new ImportError(
      "That file is a ZIP but not an Excel workbook. Export the sheet as .xlsx or .csv and try again.",
    );
  }

  const shared = readSharedStrings(parts.get("xl/sharedStrings.xml"));

  return readSheetIndex(workbookXml, parts.get("xl/_rels/workbook.xml.rels"))
    .map(({ name, path }) => {
      const xml = parts.get(path);
      return xml ? { name, rows: readSheetRows(xml, shared) } : null;
    })
    .filter((sheet): sheet is Sheet => sheet !== null);
};

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/** Read any supported file into sheets. Dispatches on the ZIP magic, not the extension. */
export const readSheets = async (file: {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}): Promise<Sheet[]> => {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 2));

  // "PK" — any Office Open XML file. Checked rather than trusting the extension,
  // because a .csv that is actually a workbook (and the reverse) is common enough.
  if (head[0] === 0x50 && head[1] === 0x4b) {
    return readXlsx(buffer);
  }

  // The old binary .xls container, which is not Office Open XML and cannot be read
  // here. Detected by its signature so the error names the actual problem instead of
  // reporting mojibake as a malformed CSV.
  if (head[0] === 0xd0 && head[1] === 0xcf) {
    throw new ImportError(
      `"${file.name}" is in the older .xls format, which is not supported. Open it and save as .xlsx or .csv.`,
    );
  }

  const text = new TextDecoder().decode(buffer);
  if (text.includes(" ")) {
    throw new ImportError(
      `"${file.name}" looks like a binary file rather than a spreadsheet or CSV.`,
    );
  }
  return [{ name: file.name, rows: parseCsv(text, guessDelimiter(text)) }];
};
