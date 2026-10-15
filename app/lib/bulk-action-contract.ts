export const BULK_SELECTION_LIMIT = 20;
export type BulkRecord = { id: number; updatedAt: string };
export type BulkRequest = { records: BulkRecord[]; action: string; value: string; confirmed: boolean };
export type BulkResult = { ok: true; count: number } | { ok: false; message: string };

export function validateBulkRequest(request: BulkRequest) {
  if (!request || request.confirmed !== true) throw new Error('Explicit confirmation is required.');
  if (!Array.isArray(request.records) || !request.records.length || request.records.length > BULK_SELECTION_LIMIT) {
    throw new Error(`Select between 1 and ${BULK_SELECTION_LIMIT} records on the current page.`);
  }
  if (request.records.some(row => !row || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) ||
      new Set(request.records.map(row => row.id)).size !== request.records.length) throw new Error('Invalid selection. Refresh the list and select again.');
  if (typeof request.action !== 'string' || typeof request.value !== 'string' || request.value.length > 100) throw new Error('Invalid bulk action.');
  return request.records.map(row => row.id).sort((a, b) => a - b);
}
