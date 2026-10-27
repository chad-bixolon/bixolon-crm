import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const destination = dirname(fileURLToPath(import.meta.url));
mkdirSync(destination, { recursive: true });

function workbook(name, sheets) {
  const book = XLSX.utils.book_new();
  for (const [sheet, rows] of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
  writeFileSync(resolve(destination, name), XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }));
}
function csv(name, headers, rows) {
  const quote = value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  writeFileSync(resolve(destination, name), [headers, ...rows].map(row => row.map(quote).join(',')).join('\n') + '\n');
}
// Price-list shapes are fabricated from the documented worksheet contract. The
// small set of named sentinel rows matches existing parser regression assertions.
const pos = [[], ['MODEL NAME', 'DESCRIPTION', '', 'MSRP', 'STANDARD']];
for (let i = 0; i < 132; i++) pos.push([
  i === 0 ? 'SRP-275IIIAOSG' : `POS-TEST-${String(i).padStart(3, '0')}`,
  `Synthetic POS printer ${i}`, '', i === 0 ? 299.20 : 200 + i,
  i === 0 ? 144.10 : 100 + i,
]);
const mobile = [[], ['MODEL NAME', 'DESCRIPTION', '', 'MSRP', 'STANDARD']];
mobile.push(['SPP-R200IIIiK', 'Bluetooth V3.0 + EDR', '', 368.50, 218.90]);
for (let i = 1; i <= 3; i++) mobile.push([`MOBILE-TEST-${i}`, `Synthetic mobile printer ${i}`, '', 300 + i, 170 + i]);
mobile.push(['SPP-R200IIIiK\nreplaced SPP-R200IIIplusiK', 'Bluetooth V4.1 + BLE', '', 368.50, 218.90]);
for (let i = 4; i <= 20; i++) mobile.push([`MOBILE-TEST-${i}`, `Synthetic mobile printer ${i}`, '', 300 + i, 170 + i]);
const label = [[], ['MODEL NAME', 'DESCRIPTION', '', 'MSRP', 'RESELLER', '', 'DISTRIBUTOR']];
for (let i = 1; i <= 19; i++) label.push([`XM7-TEST-${i}`, `Synthetic label printer ${i}`, '', i === 1 ? 646.80 : 650 + i, i === 1 ? 317 : 320 + i, '', i === 1 ? 266 : 270 + i]);
for (let i = 1; i <= 8; i++) label.push([`SPP-TEST-${i}`, `Synthetic label printer ${i}`, '', 600 + i, 300 + i, '', 250 + i]);
label.push(['LABEL-TEST-1', 'Synthetic desktop label printer', '', 500, 250, '', 200]);
const ribbon = [Array(13).fill('')];
ribbon[0][1] = 'PART NUMBER'; ribbon[0][11] = 'MSRP PER CASE';
for (let i = 0; i < 96; i++) {
  const row = Array(13).fill('');
  row[1] = i === 0 ? 'BR-WX110-11-300' : `RIBBON-TEST-${String(i).padStart(3, '0')}`;
  row[2] = i === 0 ? 'BR-WX11' : `Synthetic ribbon ${i}`;
  row[8] = 'USD'; row[9] = `Synthetic ribbon case ${i}`;
  row[11] = i === 0 ? 159.91 : 150 + i;
  row[12] = i === 0 ? 79.95 : 70 + i;
  ribbon.push(row);
}
const paper = [[], [], Array(10).fill('')];
paper[2][3] = 'NEW PART NUMBER FROM JAPAN (BOX)'; paper[2][8] = 'MSRP (USD)/BOX';
for (let i = 0; i < 7; i++) {
  const row = Array(10).fill('');
  row[1] = `Paper ${i}`; row[3] = `PAPER-TEST-${i}`;
  row[4] = 'Synthetic linerless paper'; row[5] = 'Synthetic stock';
  row[8] = 30 + i; row[9] = 20 + i;
  paper.push(row);
}
const accessory = [Array(5).fill(''), ['', 'ACCESSORY-TEST', 'Synthetic mobile accessory', 10, 20]];
accessory[0][1] = 'PART CODE'; accessory[0][4] = 'MSRP';
const warranty = [[], ['SERVICE SKU', '', 'DESCRIPTION', '', 'MSRP', 'DISTRIBUTOR'], ['WARRANTY-TEST', '', 'Synthetic service warranty', '', 40, 20]];
workbook('BIXOLON_Price_List.xlsx', [
  ['Cover', [['Synthetic price-list fixture']]], ['POS printers', pos], ['Mobile printers', mobile],
  ['Label printers', label], ['Laser printers', [[], ['MODEL NAME', 'DESCRIPTION', '', '', 'MSRP', 'RESELLER', '', 'DISTRIBUTOR'], ['LASER-TEST', 'Synthetic laser printer', '', '', 800, 500, '', 400]]],
  ['Linerless paper', paper], ['TT ribbon ', [['Older synthetic ribbon layout']]], ['TT ribbon  (2)', ribbon],
  [' Mobile Printer Accessories', accessory], ['Warranty Options', warranty],
]);

const odm = [[], ['', 'Customer', 'Bixolon Part Number', 'Old Price', 'Old Price', 'New Price', 'Tariff Separate Line (%)', 'Tariff Separate Line ($)', 'Notes']];
const customers = ['UPS', 'Amazon (thr BS -> Levata)', 'Brady', 'NCR', 'Oracle', ...Array.from({ length: 16 }, (_, i) => `Example Customer ${i + 1}`)];
const blankCustomerRows = new Set([12, 25, 48, 70, 85, 110]);
for (let sourceRow = 3; sourceRow <= 123; sourceRow++) {
  const customer = blankCustomerRows.has(sourceRow) ? '' : customers[(sourceRow - 3) % customers.length];
  odm.push(['', customer, `ODM-TEST-${String(sourceRow).padStart(3, '0')}`, 80, 90, 100, '', '', 'Synthetic pricing note']);
}
const odmRow = (number, values) => Object.assign(odm[number - 1], values);
odmRow(3, { 2: 'ODM-TEST-003', 5: 425.70 });
odmRow(4, { 1: 'Amazon (thr BS -> Levata)', 2: 'XL5-40CTG/AMZ' });
odmRow(5, { 1: 'Amazon (thr BS -> Levata)', 2: 'XL5-40CTBG/AMZ' });
odmRow(6, { 1: 'Oracle', 2: 'SPP-R310IK-ORA2', 5: '233.52160000000003', 8: '233.52' });
odmRow(9, { 2: 'HISTORICAL-TEST', 5: '-', 8: 'discontinued' });
odmRow(13, { 3: 'N/A' });
odmRow(18, { 6: 0.135, 7: 13.50 });
odmRow(24, { 8: 'Separate Line Item ' });
odmRow(30, { 5: '' });
odmRow(46, { 2: 'RSC-S300II (KM04-01262A)' });
odmRow(63, { 1: 'NCR', 2: 'SRP-S300TOEK/SBK', 5: 176.60, 6: 0.075, 7: '13.244999999999999' });
odmRow(66, { 1: 'NCR', 2: 'SRP-S300LOEK/RDU\nSRP-S300LOEK/NSU' });
odmRow(85, { 1: '', 2: 'IFJ-WDK (NEW PART IFJ-WDAK)' });
odmRow(86, { 2: 'SRP-F312IICOPK/OXO' });
odmRow(98, { 2: 'XT5-40S' });
odmRow(122, { 1: 'Brady', 2: 'XT5-43D9S/BRD (Y6727848)' });
for (let row = 3; row <= 36; row++) if (![6, 9, 24].includes(row)) odmRow(row, { 8: 'Price $99.00' });
for (const row of [...Array.from({length: 15}, (_, i) => i + 40).filter(row => row !== 48), 63]) odmRow(row, { 1: 'NCR', 6: 0.075, 8: 'Tariff 4.5%' });
workbook('ODM customer pricing_Sep 2026.xlsx', [['09.14.26', odm]]);

// Two synthetic vendor exports exercise saved custom mappings without real leads.
const fstecHeaders = ['First Name', 'Last Name', 'Email Address', 'Company Name', 'Title', 'Created Date and Time US/Eastern', 'Work Phone Number', 'Lead Access Code', 'Notes'];
const fstecRows = [fstecHeaders];
for (let i = 0; i < 15; i++) fstecRows.push([`Sample${i + 1}`, 'Attendee', `fstec-${i + 1}@example.test`, `Example Exhibitor ${i + 1}`, 'Buyer', '9/15/25 3:39 PM', `555-01${String(i).padStart(2, '0')}`, i === 0 ? 'n-qvtic0j' : `fake-${i}`, i === 0 ? 'Interested in restaurants in Canada' : 'Synthetic booth note']);
workbook('FSTEC.xlsx', [['Leads Per Booth Staff', fstecRows]]);
const retailHeaders = ['Booth Staff (App User)', 'Lead First Name', 'Lead Last Name', 'Pronouns', 'Title', 'Organization', 'Email Address', 'Work Phone', 'Cell Phone', 'Address 1', 'Address 2', 'Address 3', 'City', 'State', 'Zip/Postal Code', 'Country', 'Rating', 'Notes', 'Tags'];
const retailRows = [retailHeaders];
for (let i = 0; i < 13; i++) retailRows.push(['Sample Staff', `Retail${i + 1}`, 'Attendee', '', 'Buyer', `Example Retailer ${i + 1}`, `retail-${i + 1}@example.test`, '', `555-02${String(i).padStart(2, '0')}`, '', `Suite ${i + 1}`, '', 'Sample City', 'NY', '10001', 'USA', 'A', 'Synthetic lead note', 'fixture']);
workbook('Leads_Report_RetailNOW.xlsx', [['Leads Report', retailRows]]);

// Historical Price Exception adapter, including the shifted Expired layout.
workbook('Distributor Price Exceptions 02052020 - Copy.xlsx', [
  ['Active Disty PEs', [
    ['Distributor', 'VAR', 'Rep', 'End User', 'PE Number', 'Old PE', 'Expiration', '', 'SKU', 'Price', 'Quantity', 'Comments', 'Competitor'],
    ['Sample Distributor', 'Sample Reseller', 'Sample Rep', 'Sample Customer', 'CI-ACTIVE-1', '', '2027-12-31', '', 'SYNTH-SKU', 200, 100, 'Synthetic exception', 'Sample competitor'],
    ['Section break'],
  ]],
  ['Expired Disty PEs', [
    ['Distributor', 'VAR', 'Rep', 'End User', 'PE Number', 'Old PE', 'Expiration', 'SKU', 'Price', 'Quantity', 'Comments', 'Competitor'],
    ['Sample Distributor', 'Sample Reseller', 'Sample Rep', 'Sample Customer', 'SPR04242024', '', '2024-12-31', '', 'XL5-40CTWG', 423, 250, 'Synthetic shifted row', 'Sample competitor'],
    ['Sample Distributor', 'Sample Reseller', 'Sample Rep', 'Sample Customer', 'CI-EXPIRED-2', '', '2024-01-31', 'SYNTH-OLD-SKU', 150, 50, 'Synthetic exception', 'Sample competitor'],
  ]],
]);

const peHeaders = ['PE Number', 'Status', 'Requested At', 'Reviewed At', 'Requested By', 'Reviewed By', 'Customer', 'VAR', 'End User', 'Expiration Date', 'SKU', 'Quantity', 'Original Price', 'Approved Price', 'Currency', 'Description'];
const peCodes = ['CI-PE-001', 'SPAZ09032026-2', 'SPAZ09032026-2', 'SPAZ09032026', 'SPAZ09032026', 'SPR09022026-2', 'SPR09022026-2', 'SPAZ09042026LA', 'SPAZ08262026-2', ...Array.from({length: 13}, (_, i) => `CI-PE-${String(i + 2).padStart(3, '0')}`)];
const peRows = peCodes.map((code, index) => [
  code, 'approved', `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`, `2026-09-${String(index + 1).padStart(2, '0')}T11:00:00.000Z`,
  'Amber', 'Gary', 'Bluestar', 'Sonda in Chile', 'Falabella Stores',
  ['SPAZ09042026LA', 'SPAZ08262026-2'].includes(code) ? '3027-06-30' : '2027-06-30',
  'SRP-350PlusVK', 100 + index, '193.60', '180.00', 'USD', `Synthetic commercial request ${index + 1}`,
]);
csv('price-exceptions-2026-09-25.csv', peHeaders, peRows);

const demoHeaders = ['Request ID','Demo Number','Status','Requested At','Requested By','Reviewed At','Reviewed By','VAR','Shipping Address','Shipping Carrier','Carrier Account Number','SKU / Model','Quantity','Serial Numbers','Tracking Numbers','Inventory Locations','Shipped At','Shipped By','Duration Value','Duration Unit','Notes','Approval Comments'];
const demoRequest = (id, sku, overrides = {}) => {
  const base = {'Request ID': `00000000-0000-4000-8000-${String(id).padStart(12,'0')}`, 'Demo Number': id <= 4 ? '' : `CI-DEMO-${id}`,
    Status: id === 1 || id === 6 ? 'approved' : 'shipped', 'Requested At': '2026-09-24T10:00:00.000Z', 'Requested By': 'Amber',
    'Reviewed At': '2026-09-24T11:00:00.000Z', 'Reviewed By': 'Gary', VAR: id <= 2 ? 'CoreGroup Displays' : id === 3 ? 'PAR' : id === 4 ? 'UPS' : `Sample VAR ${id}`,
    'Shipping Address': '1 Example Way', 'Shipping Carrier': 'UPS', 'Carrier Account Number': 'CI-ACCOUNT', 'SKU / Model': sku,
    Quantity: '1', 'Serial Numbers': '', 'Tracking Numbers': '', 'Inventory Locations': '',
    'Shipped At': id === 1 || id === 6 ? '' : '2026-09-25T14:00:00.000Z', 'Shipped By': id === 1 || id === 6 ? '' : 'Jorge',
    'Duration Value': '30', 'Duration Unit': 'DAYS', Notes: 'Synthetic demo request', 'Approval Comments': 'Approved for fixture'};
  return demoHeaders.map(header => ({...base, ...overrides})[header]);
};
csv('demo-requests-2026-09-28.csv', demoHeaders, [
  demoRequest(1, 'XD5-40dEK'),
  demoRequest(2, 'XL5-40CtEG', {'Serial Numbers': 'USANNBKA26060001;USANNBKA26060002', 'Tracking Numbers': '535005300502;535005300502', 'Inventory Locations': 'HQ B12:A1;HQ B12:A1', Quantity: '2'}),
  demoRequest(3, 'XD5-40dEK'),
  demoRequest(3, 'XL5-40CtEG'),
  demoRequest(4, 'PM5-UPSDP'), demoRequest(4, 'XM7-40RFIWK/UPS'),
  demoRequest(5, 'SYNTH-DEMO-5'), demoRequest(6, 'SYNTH-DEMO-6'),
]);

const plan2027 = [['Synthetic Sales Plan'], [], ['Account', 'Plan Item', 'SKU', 'Units', 'Prior Revenue', 'Comments']];
for (let row = 4; row <= 27; row++) plan2027.push([
  row === 9 ? '' : row <= 9 ? 'UPS' : `Sample Account ${row}`,
  row === 17 ? '9442' : String(9000 + row), row <= 9 ? 'SRP-770III-303/UPS' : `SYNTH-PLAN-${row}`,
  row * 10, row * 100, 'Synthetic plan line',
]);
workbook('2027_Sales Plan_BIXNA_Rev1.xlsx', [['BIXNA Sales Plan 2027 - Rev1', plan2027]]);
const plan2025 = [['Synthetic Sales Plan'], [], ['Account', 'Sales Rep', 'SKU', 'Units', 'Revenue', 'Comments']];
for (let row = 4; row <= 38; row++) plan2025.push([
  row === 4 ? 'Brady' : `Sample Account ${row}`,
  row % 2 ? 'Mark Smith' : 'Ryan Jones', `SYNTH-PLAN-${row}`, row === 4 ? 4080 : row * 8,
  row === 4 ? 509184 : row * 110, 'Synthetic annual plan',
]);
const repSheet = (rep, count) => [['Synthetic rep plan'], [], ['Account', 'SKU', 'Units', 'Revenue', 'Comments'], ...Array.from({length: count}, (_, i) => [i === 0 ? 'Brady' : `Sample Account ${i + 4}`, `SYNTH-PLAN-${i + 4}`, i === 0 ? 4080 : (i + 4) * 8, i === 0 ? 509184 : (i + 4) * 110, `Synthetic ${rep} plan`])];
workbook('2025_Label Printer Sales PLan_2025 Development Projects_12242024.xlsx', [
  ['2025 Label Printer Sales Plan ', plan2025], ['Ryan', repSheet('Ryan', 8)], ['Mark', repSheet('Mark', 8)],
  ['Development Projects', [['Synthetic projects']]], ['Summary', [['Synthetic summary']]], ['Notes', [['Synthetic notes']]],
]);

console.log('Generated synthetic SalesHub CI source fixtures.');
