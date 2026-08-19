/**
 * Minimal ZIP reader — enough to open an .xlsx, and nothing more.
 *
 * An .xlsx is a ZIP of XML parts, so reading one needs a ZIP reader and an XML
 * parser. The XML parser is `DOMParser`, a platform API. The inflate is
 * `DecompressionStream`, also a platform API. So this costs no dependency, which is
 * the constraint the project is built under.
 *
 * Deliberately not implemented: CRC verification, encryption, multi-disk archives,
 * ZIP64. A reader that silently mis-handles ZIP64 would be worse than one that says
 * it cannot, so the ZIP64 sentinel is detected and reported rather than ignored.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** The ZIP64 "look in the extra field" sentinel. */
const ZIP64_SENTINEL = 0xffffffff;

export class ZipError extends Error {}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

/** Walk backwards for the end-of-central-directory record, which may be followed by a comment. */
const findEocd = (view: DataView): number => {
  // The comment is at most 65535 bytes, and the record itself is 22.
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= earliest; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new ZipError("Not a ZIP file — no end-of-central-directory record found.");
};

const readCentralDirectory = (view: DataView): CentralEntry[] => {
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  const start = view.getUint32(eocd + 16, true);

  if (start === ZIP64_SENTINEL) {
    throw new ZipError("This file uses the ZIP64 format, which this reader does not support.");
  }

  const decoder = new TextDecoder();
  const entries: CentralEntry[] = [];
  let cursor = start;

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError(`Malformed ZIP: central directory entry ${i + 1} has a bad signature.`);
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);

    if (compressedSize === ZIP64_SENTINEL || localOffset === ZIP64_SENTINEL) {
      throw new ZipError("This file uses the ZIP64 format, which this reader does not support.");
    }

    const name = decoder.decode(
      new Uint8Array(view.buffer, view.byteOffset + cursor + 46, nameLength),
    );

    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
};

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === "undefined") {
    throw new ZipError(
      "This browser cannot decompress the file. Save the sheet as CSV and upload that instead.",
    );
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const readEntry = async (view: DataView, entry: CentralEntry): Promise<Uint8Array> => {
  const offset = entry.localOffset;
  if (view.getUint32(offset, true) !== LOCAL_SIGNATURE) {
    throw new ZipError(`Malformed ZIP: "${entry.name}" has a bad local header.`);
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;

  // The central directory's sizes are used rather than the local header's, because a
  // local header written with a data descriptor carries zeros.
  const raw = new Uint8Array(view.buffer, view.byteOffset + start, entry.compressedSize);

  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  throw new ZipError(`"${entry.name}" uses compression method ${entry.method}, which is not supported.`);
};

/**
 * Read the named entries as text. Entries absent from the archive are simply absent
 * from the result, so a caller can treat an optional part (sharedStrings.xml) as
 * optional without a separate existence check.
 */
export const readZipText = async (
  buffer: ArrayBuffer,
  wanted: (name: string) => boolean,
): Promise<Map<string, string>> => {
  const view = new DataView(buffer);
  const entries = readCentralDirectory(view).filter((e) => wanted(e.name));
  const decoder = new TextDecoder();
  const out = new Map<string, string>();

  for (const entry of entries) {
    out.set(entry.name, decoder.decode(await readEntry(view, entry)));
  }
  return out;
};

/** Entry names only — used to give a useful error when a file is not a workbook. */
export const listZipEntries = (buffer: ArrayBuffer): string[] =>
  readCentralDirectory(new DataView(buffer)).map((e) => e.name);
