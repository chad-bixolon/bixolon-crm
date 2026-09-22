import readExcelFile from 'read-excel-file/node';
import { inflateRawSync } from 'node:zlib';

export const maxXlsxBytes = 4_000_000;
export const maxXlsxRows = 5_000;
const maxUncompressedBytes = 20_000_000;
const maxEntries = 100;
const maxColumns = 50;

export type XlsxResult = { csv?: string; sheets: string[]; selectedSheet?: string; error?: string };
export type XlsxTransform = (sheet:string, rows:string[][]) => { rows?:string[][]; error?:string };

export function inspectZip(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) return 'Password-protected or encrypted Office workbooks are not supported. Save an unencrypted .xlsx copy.';
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return 'Unsupported workbook. Upload a valid .xlsx file.';
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return 'Malformed XLSX workbook: ZIP directory is missing.';
  const entries = buffer.readUInt16LE(end + 10), directorySize = buffer.readUInt32LE(end + 12), directoryOffset = buffer.readUInt32LE(end + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return 'Unsupported XLSX workbook: ZIP64 is not supported.';
  if (entries > maxEntries || directoryOffset + directorySize > end) return 'Workbook is too large or malformed.';
  let offset = directoryOffset, total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) return 'Malformed XLSX workbook: invalid ZIP directory.';
    const flags = buffer.readUInt16LE(offset + 8), compressed = buffer.readUInt32LE(offset + 20), uncompressed = buffer.readUInt32LE(offset + 24);
    const method = buffer.readUInt16LE(offset + 10), localOffset = buffer.readUInt32LE(offset + 42);
    const filenameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    if (flags & 1) return 'Password-protected or encrypted workbooks are not supported. Save an unencrypted .xlsx copy.';
    if (uncompressed === 0xffffffff || compressed === 0xffffffff) return 'Unsupported XLSX workbook: ZIP64 is not supported.';
    total += uncompressed;
    if (total > maxUncompressedBytes || uncompressed > 10_000_000 || (compressed && uncompressed / compressed > 200)) return 'Workbook expands beyond the 20 MB safety limit.';
    if (localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) return 'Malformed XLSX workbook: invalid ZIP entry.';
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (dataOffset + compressed > directoryOffset || ![0,8].includes(method)) return 'Unsupported or malformed XLSX compression.';
    try {
      const data = buffer.subarray(dataOffset,dataOffset + compressed);
      const actual = method === 0 ? data.length : inflateRawSync(data,{maxOutputLength:10_000_001}).length;
      if (actual !== uncompressed) return 'Malformed XLSX workbook: ZIP entry size does not match.';
    } catch { return 'Workbook cannot be safely decompressed or exceeds the 20 MB limit.'; }
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  if (offset !== directoryOffset + directorySize) return 'Malformed XLSX workbook: invalid ZIP directory length.';
  return undefined;
}

function cellString(value: unknown, preserveNewlines=false): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'string') return preserveNewlines ? value : value.trim().replace(/\r\n|\r|\n/g, ' ');
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error('Workbook contains an unsupported cell value.');
}
function csvCell(value: string): string { return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }

export async function parseImportXlsx(buffer: Buffer, requestedSheet?: string, transform?:XlsxTransform): Promise<XlsxResult> {
  if (!buffer.length || buffer.length > maxXlsxBytes) return {sheets:[],error:'Choose an .xlsx file smaller than 4 MB.'};
  const zipError = inspectZip(buffer);
  if (zipError) return {sheets:[],error:zipError};
  try {
    // Preserve decimal text: numeric phone and postal values must not pass through JS rounding.
    const workbook = await readExcelFile<string>(buffer, {parseNumber: value => value});
    const sheets = workbook.filter(sheet => sheet.data.some(row => row.some(value => cellString(value) !== '')));
    if (!sheets.length) return {sheets:[],error:'Workbook has no worksheet with import data.'};
    if (sheets.reduce((sum,sheet) => sum + sheet.data.length,0) > 10_000) return {sheets:[],error:'Workbook has too many rows. Limit: 10,000 rows across worksheets.'};
    const names = sheets.map(sheet => sheet.sheet);
    if (requestedSheet && !names.includes(requestedSheet)) return {sheets:names,error:'Selected worksheet is unavailable. Preview the workbook again.'};
    if (names.length > 1 && !requestedSheet) return {sheets:names,error:'Choose the worksheet to import. Worksheets are never combined.'};
    const selected = sheets.find(sheet => sheet.sheet === (requestedSheet ?? names[0]))!;
    if (selected.data.length - 1 > maxXlsxRows) return {sheets:names,error:'Worksheet exceeds 5,000 data rows.'};
    if (selected.data.some(row => row.length > maxColumns)) return {sheets:names,error:`Worksheet exceeds ${maxColumns} columns.`};
    const sourceRows=selected.data.map(row=>row.map(value=>cellString(value,!!transform)));
    const transformed=transform ? transform(selected.sheet,sourceRows) : {rows:sourceRows};
    if (transformed.error || !transformed.rows) return {sheets:names,selectedSheet:selected.sheet,error:transformed.error ?? 'Worksheet could not be mapped.'};
    const csv = transformed.rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n';
    if (csv.length > 2_000_000) return {sheets:names,error:'Worksheet values exceed the 2 MB import limit.'};
    return {csv,sheets:names,selectedSheet:selected.sheet};
  } catch {
    return {sheets:[],error:'Malformed or unsupported XLSX workbook. Save a standard unencrypted .xlsx file and try again.'};
  }
}
