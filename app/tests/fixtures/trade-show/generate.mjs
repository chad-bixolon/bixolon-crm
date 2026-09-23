import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import XLSX from 'xlsx';

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));

export const fixtureDefinitions = {
  nra_nrf: {
    filename: 'nra-nrf-known-profile.xlsx',
    sheet: 'ExportExtensionsFlatFile1',
    rows: [
      ['Captured Date', 'FirstName', 'LastName', 'Company', 'Email', 'Phone', 'Address', 'Address2', 'City', 'StateCode', 'ZipCode', 'CountryCode', 'Title', 'Company Website', 'Notes', 'Badge Id', 'Lead Origin', 'Primary job function', 'Survey: Purchase timing'],
      ['5/19/26 9:15 AM', 'Alice', 'Example', 'Example Retail', 'ALICE@example.test', 4045550100, '1 Trade Way', 'Suite 2', 'Atlanta', 'GA', 1234, 'US', 'Buyer', 'www.example.test', 'Asked for follow-up', 'NRA-001', 'Booth scan', 'Purchasing', '0-3 months'],
      ['5/19/26 10:45 AM', 'Alex', 'Sample', 'Example Retail', 'alice@example.test', '(not provided)', '2 Market St', '', 'Boston', 'MA', '02110', 'US', '(not provided)', 'https://example.test', 'Second scan with shared email', 'NRA-002', 'Mobile scan', 'Operations', '3-6 months'],
    ],
    numericFormats: { F2: '0000000000', K2: '00000' },
  },
  modex: {
    filename: 'modex-xpressleads-known-profile.xlsx',
    sheet: 'Downloads',
    rows: [
      ['DeviceLabel', 'Scan Date/Time', 'First Name', 'Last Name', 'Company', 'Email', 'Phone', 'Address 1', 'Address 2', 'City', 'State/Province', 'Zipcode', 'Country', 'Title', 'Company Website', 'Notes', 'Badge Id', 'Lead Origin', 'Survey: Printer requirement'],
      ['Scanner 7', '2026-04-14 13:05:00', 'Morgan', 'Example', 'Example Logistics', 'MORGAN@example.test', 7705550123, '10 Expo Dr', '', 'Atlanta', 'GA', 30303, 'US', 'Engineer', 'example-logistics.test', 'Requested specifications', 'MODX-001', 'Exhibitor scan', 'Mobile printer'],
      ['Scanner 8', '2026-04-14 14:30:00', 'Mora', 'Sample', 'Example Logistics', 'morgan@example.test', '(none)', '11 Expo Dr', 'Floor 2', 'Atlanta', 'GA', '30303', 'US', '(none)', 'https://example-logistics.test', 'Shared email, separate scan', 'MODX-002', 'Exhibitor scan', 'Desktop printer'],
    ],
    numericFormats: { G2: '0000000000', L2: '00000' },
  },
};

export function buildFixture(profile, bookType = 'xlsx') {
  const definition = fixtureDefinitions[profile];
  if (!definition) throw new Error(`Unknown fixture profile: ${profile}`);
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(definition.rows);
  for (const [address, format] of Object.entries(definition.numericFormats)) worksheet[address].z = format;
  XLSX.utils.book_append_sheet(workbook, worksheet, definition.sheet);
  return XLSX.write(workbook, { type: 'buffer', bookType });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  for (const [profile, definition] of Object.entries(fixtureDefinitions)) {
    fs.writeFileSync(path.join(fixtureDirectory, definition.filename), buildFixture(profile));
  }
}
