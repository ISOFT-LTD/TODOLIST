/**
 * The plugin's key inventory: every translation key the Todo plugin asks the
 * application for, and the tools that read the list and build its workbook.
 *
 *   todo-translation-keys.csv    the inventory, the one authoritative list
 *   todo-translation-keys.xlsx   the same keys as a sheet, for preparing the import
 *
 * KEYS ONLY. One column, `key`, one key on each line. There is no text here
 * in any language: the texts are in the centralized translation database,
 * and the plugin reads them from the Core through sdk.i18n. This list says
 * which rows that database needs; it is not a catalog and cannot serve as one.
 *
 * The CSV is the source: a text file that a review can read and a diff can
 * show. The workbook is built from it (`npm run translation-keys`) and a
 * test checks that the two hold the same keys.
 *
 * Node only. Nothing the plugin ships imports this file.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));

export const INVENTORY_FILE = join(HERE, 'todo-translation-keys.csv');
export const WORKBOOK_FILE = join(HERE, 'todo-translation-keys.xlsx');

const COLUMN = 'key';
const SHEET_NAME = 'keys';

/** What a line of the inventory may be: a key, and nothing a text would need. */
const KEY = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

// --- Inventory --------------------------------------------------------------

/**
 * The inventory as an array of keys, in file order. Throws on anything that
 * is not a key - a second column, a space, a capital - so that a text cannot
 * be put beside a key, by mistake or otherwise.
 */
export function readInventory(file = INVENTORY_FILE) {
  const [header, ...lines] = readFileSync(file, 'utf8').split(/\r?\n/);
  if (header !== COLUMN) {
    throw new Error(`${file}: the first line must be exactly "${COLUMN}", found "${header}"`);
  }
  return lines
    .filter((line) => line !== '')
    .map((line, index) => {
      if (!KEY.test(line)) {
        throw new Error(`${file}, line ${index + 2}: "${line}" is not a key. The inventory holds keys only, one on each line.`);
      }
      return line;
    });
}

// --- Workbook (xlsx) ------------------------------------------------------
//
// An xlsx file is a zip of XML parts. What is written here is the least a
// workbook needs - one sheet, inline strings, a bold header in a plain
// font - and it is written the same way every time, so that building it
// twice gives the same bytes. Reading covers what Excel writes back after a
// person edits the sheet: deflated parts and shared strings.

const escapeXml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const unescapeXml = (text) => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&amp;/g, '&');

/** A1, B1, ... AA1 for a zero-based column. */
function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(64 + ((n - 1) % 26) + 1) + name;
  }
  return name;
}

function columnIndex(name) {
  let index = 0;
  for (const char of name) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function sheetXml(rows) {
  const widths = rows[0].map((_, column) => Math.min(80, Math.max(12, ...rows.map((row) => String(row[column] ?? '').length + 2))));
  const cols = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
  const cell = (r, c, value, style) =>
    `<c r="${columnName(c)}${r}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  const data = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cell(r + 1, c, value, r === 0 ? 1 : 0)).join('')}</row>`)
    .join('');
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<cols>${cols}</cols><sheetData>${data}</sheetData></worksheet>`;
}

const PARTS = {
  '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>',
  '_rels/.rels': `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>',
  'xl/workbook.xml': `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets><sheet name="${SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>',
  'xl/styles.xml': `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>',
};

// --- zip --------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Every entry is dated the same, so the bytes depend on the rows alone.
const DOS_DATE = (1980 - 1980) << 9 | 1 << 5 | 1;
const DOS_TIME = 0;

function zip(entries, { compress = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const stored = compress ? deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBytes, stored);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + stored.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, end]);
}

/** name -> text of every part in a zip. */
function unzip(buffer) {
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(endOffset + 10);
  let position = buffer.readUInt32LE(endOffset + 16);
  const parts = new Map();

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(position) !== 0x02014b50) throw new Error('bad central directory');
    const method = buffer.readUInt16LE(position + 10);
    const compressed = buffer.readUInt32LE(position + 20);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const localOffset = buffer.readUInt32LE(position + 42);
    const name = buffer.toString('utf8', position + 46, position + 46 + nameLength);
    position += 46 + nameLength + extraLength + commentLength;

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressed);
    if (method === 0) parts.set(name, raw.toString('utf8'));
    else if (method === 8) parts.set(name, inflateRawSync(raw).toString('utf8'));
    else throw new Error(`${name}: compression method ${method} is not supported`);
  }
  return parts;
}

// --- Workbook in and out ----------------------------------------------------

/**
 * A workbook holding `rows` (arrays of strings, the header first) on one
 * sheet. Returns the file's bytes.
 */
export function buildWorkbook(rows, { compress = false } = {}) {
  const entries = Object.entries(PARTS);
  entries.push(['xl/worksheets/sheet1.xml', sheetXml(rows)]);
  return zip(entries, { compress });
}

/** The text of a cell's <is> or <si>: its <t> runs joined. */
const runsOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(([, t]) => unescapeXml(t)).join('');

/**
 * The sheets of a workbook: [{ name, rows }], each row an array of strings,
 * trailing empty cells dropped. Reads what this module writes and what Excel
 * writes back: shared strings, inline strings, formula results and numbers.
 */
export function readWorkbook(buffer) {
  const parts = unzip(buffer);
  const need = (name) => {
    if (!parts.has(name)) throw new Error(`${name} is missing from the workbook`);
    return parts.get(name);
  };

  const shared = [...(parts.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) => runsOf(si));

  const rels = new Map(
    [...need('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)].map(([tag]) => [
      /Id="([^"]*)"/.exec(tag)[1],
      /Target="([^"]*)"/.exec(tag)[1],
    ]),
  );

  return [...need('xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)].map(([tag]) => {
    const name = unescapeXml(/name="([^"]*)"/.exec(tag)[1]);
    const target = rels.get(/r:id="([^"]*)"/.exec(tag)[1]);
    const xml = need(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    const rows = [];

    for (const [, rowXml] of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const [cellXml, ref, type] of rowXml.matchAll(/<c\s+r="([A-Z]+)\d+"(?:[^>]*?\st="([^"]*)")?[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
        const column = columnIndex(ref);
        let value = '';
        if (type === 'inlineStr') value = runsOf(cellXml);
        else {
          const v = /<v>([^<]*)<\/v>/.exec(cellXml);
          if (v) value = type === 's' ? shared[Number(v[1])] : unescapeXml(v[1]);
        }
        while (row.length < column) row.push('');
        row[column] = value;
      }
      while (row.length && row[row.length - 1] === '') row.pop();
      if (row.length) rows.push(row);
    }
    return { name, rows };
  });
}
