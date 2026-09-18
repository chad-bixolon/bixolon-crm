export const importHeaders = [
  'record_type','account_name','account_status','website','phone','owner_email','territory_code','industry_code','business_roles','strategic_account',
  'address_line_1','address_line_2','city','state_province','postal_code','country',
  'contact_first_name','contact_last_name','contact_title','contact_email','contact_phone','contact_mobile','contact_account_name','contact_active','contact_primary',
] as const;
export type ImportHeader = typeof importHeaders[number];
export type CsvRow = { line: number; values: Partial<Record<ImportHeader,string>> };
export const template = importHeaders.join(',') + '\n';

export function parseImportCsv(input: string, catalogHeaders?: readonly string[]): { rows: CsvRow[]; errors: string[] } {
  const errors: string[] = [];
  if (!input || input.length > 2_000_000) return { rows: [], errors: ['Choose a UTF-8 CSV file smaller than 2 MB.'] };
  const source = input.replace(/^\uFEFF/, '');
  const records: {line:number; cells:string[]}[] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, start = 1;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else { cell += c; if (c === '\n') line++; }
    } else if (c === ',' || c === '\n' || c === '\r') {
      cells.push(cell.trim()); cell = ''; closed = false;
      if (c !== ',') {
        if (cells.some(Boolean)) records.push({line:start,cells});
        cells = []; if (c === '\r' && source[i+1] === '\n') i++; line++; start = line;
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === '"' || closed) return {rows:[],errors:[`Malformed CSV at line ${line}: unexpected character after a quoted value.`]};
    else cell += c;
  }
  if (quoted) return {rows:[],errors:[`Malformed CSV at line ${start}: unclosed quoted value.`]};
  cells.push(cell.trim()); if (cells.some(Boolean)) records.push({line:start,cells});
  if (!records.length) return {rows:[],errors:['CSV header row is required.']};
  const headers = records[0].cells.map(x => x.toLowerCase());
  const duplicates = headers.filter((h,i) => headers.indexOf(h) !== i);
  if (duplicates.length) errors.push(`Duplicate column header: ${[...new Set(duplicates)].join(', ')}.`);
  const unknown = headers.filter(h => !(catalogHeaders ?? importHeaders).includes(h));
  if (unknown.length) errors.push(`Unsupported column: ${unknown.join(', ')}.${unknown.some(x => x.includes('external') || x.includes('source')) ? ' Source IDs require a schema migration.' : ''}`);
  if (catalogHeaders) {
    for (const required of ['model','part_number']) if (!headers.includes(required)) errors.push(`Missing required header: ${required}.`);
  } else {
    if (!headers.includes('record_type')) errors.push('Missing required header: record_type.');
    if (!headers.includes('account_name') && !headers.includes('contact_first_name')) errors.push('Include account_name or contact_first_name and contact_last_name headers.');
    if (headers.includes('contact_first_name') !== headers.includes('contact_last_name')) errors.push('Contact first and last name headers must appear together.');
  }
  if (errors.length) return {rows:[], errors};
  const rows: CsvRow[] = [];
  for (const record of records.slice(1)) {
    if (record.cells.length > headers.length) { errors.push(`Line ${record.line}: expected at most ${headers.length} columns, found ${record.cells.length}.`); continue; }
    rows.push({line:record.line,values:Object.fromEntries(headers.map((h,i) => [h,record.cells[i] ?? '']))});
  }
  return {rows,errors};
}
