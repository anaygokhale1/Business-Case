/**
 * Tests for the import chain: number parsing, CSV, the ZIP/xlsx reader, and the
 * header mapping.
 *
 * The xlsx test builds a real ZIP in memory using STORED entries, so the archive
 * structure — central directory, local headers, offsets — is genuinely exercised
 * without depending on a deflate implementation being present in the test
 * environment. Compression method 8 is one branch away and covered by a unit check.
 */

import { describe, expect, it } from "vitest";

import { looksLikeTimeSerial, parseCellNumber } from "./numbers";
import {
  columnIndex,
  guessDelimiter,
  ImportError,
  parseCsv,
  readSheets,
  readXlsx,
} from "./tabular";
import {
  convertStudyRows,
  detectHeaderRow,
  importStudySheet,
  proposeMapping,
} from "./time-study-map";
import { listZipEntries, ZipError } from "./zip";

/* -------------------------------------------------------------------------- */
/* A minimal ZIP writer, for the fixture only                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build a ZIP with stored (uncompressed) entries.
 *
 * CRCs are written as zero, which the reader does not verify — the reader's contract
 * is deliberately narrow, and this fixture exercises exactly that contract.
 */
const makeZip = (files: Array<{ name: string; content: string }>): ArrayBuffer => {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    parts.push(local, data);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, 0, true); // stored
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    central.push(dir);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, eocd];
  const total = all.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of all) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out.buffer;
};

const asFile = (name: string, buffer: ArrayBuffer) => ({
  name,
  arrayBuffer: async () => buffer,
});

const textFile = (name: string, content: string) =>
  asFile(name, new TextEncoder().encode(content).buffer as ArrayBuffer);

/* -------------------------------------------------------------------------- */
/* Number parsing                                                             */
/* -------------------------------------------------------------------------- */

describe("parseCellNumber", () => {
  const value = (raw: string) => parseCellNumber(raw).value;

  it("reads plain numbers", () => {
    expect(value("31")).toBe(31);
    expect(value("18.5")).toBe(18.5);
    expect(value("  42  ")).toBe(42);
  });

  it("reads accounting negatives in parentheses", () => {
    // Number("(1,234)") is NaN, and a NaN that becomes 0 downstream is the bug this
    // whole module exists to prevent.
    expect(value("(1,234)")).toBe(-1234);
  });

  it("handles both thousands conventions by position, not locale", () => {
    expect(value("1,234.56")).toBe(1234.56);
    expect(value("1.234,56")).toBe(1234.56);
    expect(value("1 880")).toBe(1880);
  });

  it("handles a non-breaking space as a thousands separator", () => {
    // Excel writes U+00A0 in some locales, and it is invisible in a diff.
    expect(value("1 880")).toBe(1880);
    expect(value("240 000")).toBe(240000);
  });

  it("strips currency symbols and apostrophe prefixes", () => {
    expect(value("$85,000")).toBe(85000);
    expect(value("'42")).toBe(42);
  });

  it("resolves a lone three-digit group by the caller's hint, and says it was ambiguous", () => {
    // "1.234" is 1234 in a European export and 1.234 anywhere else. The string cannot
    // settle it; the column can, and the caller knows the column.
    expect(parseCellNumber("1.234", { grouping: "thousands" }).value).toBe(1234);
    expect(parseCellNumber("1.234", { grouping: "decimal" }).value).toBe(1.234);
    expect(parseCellNumber("1.234").note).toContain("could be read either way");
  });

  it("needs no hint when the grouping is unambiguous", () => {
    // Several groups can only be thousands; a non-three-digit tail can only be decimal.
    expect(parseCellNumber("1,234,567", { grouping: "decimal" }).value).toBe(1_234_567);
    expect(parseCellNumber("18,5", { grouping: "thousands" }).value).toBe(18.5);
    expect(parseCellNumber("0.0059", { grouping: "thousands" }).value).toBe(0.0059);
  });

  it("only flags the dot case, so the report does not fill with noise", () => {
    // A decimal comma with exactly three places is rare; a dot that means either thing
    // is common. Flagging every English "1,234" would train the user to skip the report.
    expect(parseCellNumber("1,234", { grouping: "thousands" }).note).toBeUndefined();
    expect(parseCellNumber("1.234", { grouping: "thousands" }).note).toBeDefined();
  });

  it("expands magnitude suffixes and says that it did", () => {
    expect(parseCellNumber("85K")).toEqual({ value: 85000, note: expect.stringContaining("thousands") });
    expect(value("1.2m")).toBe(1_200_000);
  });

  it("does not read a word ending in a suffix letter as a number", () => {
    // "Bulk" ends in k. A task name must not become 0 thousands.
    expect(value("Bulk")).toBeNull();
    expect(value("Adjustment")).toBeNull();
  });

  it("reads m:ss as minutes and flags the guess", () => {
    const parsed = parseCellNumber("8:30");
    expect(parsed.value).toBeCloseTo(8.5, 9);
    // Two-part clock time is genuinely ambiguous, so the interpretation is surfaced
    // rather than applied silently.
    expect(parsed.note).toContain("8 min 30 sec");
  });

  it("reads h:mm:ss unambiguously", () => {
    expect(parseCellNumber("1:30:00").value).toBe(90);
    expect(parseCellNumber("0:08:30").value).toBeCloseTo(8.5, 9);
  });

  it("returns null for blanks and dashes rather than 0", () => {
    expect(value("")).toBeNull();
    expect(value("   ")).toBeNull();
    expect(value("-")).toBeNull();
    expect(value("—")).toBeNull();
    expect(value("#DIV/0!")).toBeNull();
    expect(value("n/a")).toBeNull();
  });

  it("recognises a value that looks like an Excel time serial", () => {
    expect(looksLikeTimeSerial(0.0059)).toBe(true);
    expect(looksLikeTimeSerial(8.5)).toBe(false);
    expect(looksLikeTimeSerial(0)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

describe("parseCsv", () => {
  it("handles quoted fields containing the delimiter and newlines", () => {
    const rows = parseCsv('Task,Minutes\n"Intake, urgent",31\n"Multi\nline",12');
    expect(rows[1]).toEqual(["Intake, urgent", "31"]);
    expect(rows[2]).toEqual(["Multi\nline", "12"]);
  });

  it("handles doubled quotes", () => {
    expect(parseCsv('a,"say ""hi""",c')[0]).toEqual(["a", 'say "hi"', "c"]);
  });

  it("strips a UTF-8 BOM so the first header still matches", () => {
    const rows = parseCsv("﻿Task,Minutes\nIntake,31");
    expect(rows[0]?.[0]).toBe("Task");
  });

  it("treats CRLF and lone CR as line endings", () => {
    expect(parseCsv("a,b\r\nc,d")).toHaveLength(2);
    expect(parseCsv("a,b\rc,d")).toHaveLength(2);
  });

  it("pads ragged rows so every row has the same width", () => {
    const rows = parseCsv("a,b,c\n1\n2,3");
    expect(rows.every((r) => r.length === 3)).toBe(true);
  });

  it("guesses the delimiter from the header line", () => {
    expect(guessDelimiter("Task;Minutes;Volume\nIntake;31;100")).toBe(";");
    expect(guessDelimiter("Task\tMinutes")).toBe("\t");
    expect(guessDelimiter("SingleColumn")).toBe(",");
  });
});

/* -------------------------------------------------------------------------- */
/* ZIP / xlsx                                                                 */
/* -------------------------------------------------------------------------- */

const WORKBOOK = `<?xml version="1.0"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Time Study" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const RELS = `<?xml version="1.0"?>
<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;

const SHARED = `<?xml version="1.0"?>
<sst><si><t>Task</t></si><si><t>Minutes</t></si><si><t>Annual Volume</t></si>
<si><t>New claim </t><t>intake</t></si></sst>`;

const SHEET = `<?xml version="1.0"?>
<worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
  <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>31</v></c><c r="C2"><v>240000</v></c></row>
  <row r="3"><c r="A3" t="inlineStr"><is><t>Adjustment</t></is></c><c r="B3"><v>18</v></c><c r="C3"><v>410000</v></c></row>
</sheetData></worksheet>`;

const workbookZip = () =>
  makeZip([
    { name: "xl/workbook.xml", content: WORKBOOK },
    { name: "xl/_rels/workbook.xml.rels", content: RELS },
    { name: "xl/sharedStrings.xml", content: SHARED },
    { name: "xl/worksheets/sheet1.xml", content: SHEET },
  ]);

describe("column references", () => {
  it("converts letters to zero-based indices", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("B2")).toBe(1);
    expect(columnIndex("Z10")).toBe(25);
    expect(columnIndex("AA1")).toBe(26);
    expect(columnIndex("BC7")).toBe(54);
  });
});

describe("zip reader", () => {
  it("lists entries from the central directory", () => {
    expect(listZipEntries(workbookZip())).toEqual([
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/sharedStrings.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("rejects a file with no end-of-central-directory record", () => {
    const notAZip = new TextEncoder().encode("this is not a zip").buffer as ArrayBuffer;
    expect(() => listZipEntries(notAZip)).toThrow(ZipError);
  });
});

describe("xlsx reader", () => {
  it("reads the sheet name and cell values", async () => {
    const sheets = await readXlsx(workbookZip());
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.name).toBe("Time Study");
    expect(sheets[0]!.rows[0]).toEqual(["Task", "Minutes", "Annual Volume"]);
    expect(sheets[0]!.rows[2]).toEqual(["Adjustment", "18", "410000"]);
  });

  it("joins a shared string split across formatting runs", async () => {
    const sheets = await readXlsx(workbookZip());
    // "New claim " + "intake" — taking only the first <t> would truncate any header
    // with a bold word in it.
    expect(sheets[0]!.rows[1]?.[0]).toBe("New claim intake");
  });

  it("dispatches on the file's magic bytes, not its extension", async () => {
    // A workbook misnamed .csv still reads as a workbook.
    const sheets = await readSheets(asFile("study.csv", workbookZip()));
    expect(sheets[0]!.name).toBe("Time Study");
  });

  it("names the actual problem for an old .xls file", async () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    await expect(readSheets(asFile("old.xls", xls.buffer as ArrayBuffer))).rejects.toThrow(/older \.xls format/);
  });

  it("says a ZIP that is not a workbook is not a workbook", async () => {
    const zip = makeZip([{ name: "readme.txt", content: "hello" }]);
    await expect(readXlsx(zip)).rejects.toThrow(ImportError);
  });

  it("reads a CSV through the same entry point", async () => {
    const sheets = await readSheets(textFile("study.csv", "Task,Minutes\nIntake,31"));
    expect(sheets[0]!.rows[1]).toEqual(["Intake", "31"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Header detection and mapping                                               */
/* -------------------------------------------------------------------------- */

describe("header detection", () => {
  it("finds the header below a title block", () => {
    const rows = [
      ["Northwind Assurance — Claims Time Study", "", "", ""],
      ["", "", "", ""],
      ["Prepared 2026-06-01", "", "", ""],
      ["Task Type", "Region", "Handle Time (min)", "Annual Volume"],
      ["Intake", "Europe", "31", "240000"],
    ];
    expect(detectHeaderRow(rows)).toBe(3);
  });

  it("defaults to the first row when nothing looks like a header", () => {
    expect(detectHeaderRow([["a", "b"], ["c", "d"]])).toBe(0);
  });
});

describe("mapping proposal", () => {
  it("maps the obvious headers", () => {
    expect(proposeMapping(["Task Type", "Region", "Handle Time (min)", "Annual Volume"])).toEqual({
      taskType: 0,
      region: 1,
      minutes: 2,
      volume: 3,
    });
  });

  it("prefers an exact match over a mere substring", () => {
    // Both contain "time"; "Handle time" is the handle time.
    const mapping = proposeMapping(["Activity", "Time in system", "Handle time", "Cases"]);
    expect(mapping.minutes).toBe(2);
  });

  it("never assigns one column to two fields", () => {
    const mapping = proposeMapping(["Transactions", "Transaction time"]);
    const used = [mapping.taskType, mapping.minutes, mapping.volume, mapping.region].filter(
      (c): c is number => c !== null,
    );
    expect(new Set(used).size).toBe(used.length);
  });

  it("reports a missing column as null rather than guessing one", () => {
    const mapping = proposeMapping(["Task", "Minutes"]);
    expect(mapping.volume).toBeNull();
    expect(mapping.region).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

describe("converting rows", () => {
  const sheet = {
    name: "Study",
    rows: [
      ["Task", "Region", "Minutes", "Volume"],
      ["Intake", "Europe", "31", "240,000"],
      ["Adjustment", "Europe", "18", "410000"],
      ["", "", "", ""],
      ["Subtotal", "", "", ""],
      ["Coverage review", "APAC", "not measured", "96000"],
      ["Settlement", "", "26", "180000"],
      ["Reopened", "Europe", "-5", "1000"],
    ],
  };

  const result = () => importStudySheet(sheet, null);

  it("keeps the good rows and reports each skipped one by its sheet row number", () => {
    const { rows, issues } = result();
    expect(rows.map((r) => r.taskType)).toEqual([
      "Intake",
      "Adjustment",
      "Settlement",
    ]);

    const dropped = issues.filter((i) => i.dropped);
    // Row 5 is a subtotal, row 6 has unparseable minutes, row 8 is negative. The row
    // numbers are 1-based so they match what the user sees in Excel.
    expect(dropped.map((i) => i.sheetRow)).toEqual([5, 6, 8]);
  });

  it("does not count blank lines as considered rows", () => {
    expect(result().considered).toBe(6);
  });

  it("takes the region from the row and falls back to the default", () => {
    const { rows, regions } = result();
    expect(rows[0]!.region).toBe("Europe");
    // "Settlement" had no region and the default was portfolio-wide, so the key is
    // absent rather than set to undefined.
    expect("region" in rows[2]!).toBe(false);
    expect(regions).toEqual(["Europe"]);
  });

  it("applies a default region to rows that have none", () => {
    const { rows } = convertStudyRows(sheet, 0, proposeMapping(sheet.rows[0]!), "North America");
    expect(rows[2]!.region).toBe("North America");
  });

  it("parses a thousands-separated volume", () => {
    expect(result().rows[0]!.volume).toBe(240_000);
  });

  it("reads the minutes column as decimal and the volume column as thousands", () => {
    const ambiguous = {
      name: "S",
      rows: [
        ["Task", "Minutes", "Volume"],
        ["Intake", "1.500", "2.400"],
      ],
    };
    const { rows } = importStudySheet(ambiguous, null);
    // One and a half minutes, two thousand four hundred items. The same string read
    // two different ways, correctly, because the column says which is which.
    expect(rows[0]!.minutes).toBe(1.5);
    expect(rows[0]!.volume).toBe(2400);
  });

  it("flags a sub-minute handle time without converting it", () => {
    const timed = {
      name: "Study",
      rows: [
        ["Task", "Minutes", "Volume"],
        ["Intake", "0.0059", "1000"],
      ],
    };
    const { rows, issues } = importStudySheet(timed, null);
    // Kept as-is: a genuine sub-minute task is indistinguishable from a
    // time-formatted cell, so the user decides.
    expect(rows[0]!.minutes).toBe(0.0059);
    expect(issues[0]!.dropped).toBe(false);
    expect(issues[0]!.message).toContain("under a minute");
  });

  it("names an unnamed row after its sheet row, so it can be found", () => {
    const unnamed = { name: "S", rows: [["Task", "Minutes", "Volume"], ["", "10", "500"]] };
    expect(importStudySheet(unnamed, null).rows[0]!.taskType).toBe("Row 2");
  });
});
