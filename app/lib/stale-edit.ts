/** Values originate on the server when the form opens, never from a browser clock. */
export const recordChangedMessage = 'This record changed after you opened it. Review the latest version before saving again.';
export class RecordChangedError extends Error {
  constructor() { super(recordChangedMessage); this.name = 'RecordChangedError'; }
}
export function requireEditToken(form: FormData): string {
  const value = form.get('editToken');
  if (form.getAll('editToken').length !== 1 || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new RecordChangedError();
  return value;
}
export function assertEditToken(current: Date, submitted: string) {
  if (current.toISOString() !== submitted) throw new RecordChangedError();
}
/** Advance even when successive writes occur within the same server millisecond. */
export function nextUpdatedAt(previous?: Date): Date {
  return new Date(Math.max(Date.now(), previous ? previous.getTime() + 1 : 0));
}
export function isRecordChanged(error: unknown): boolean {
  return error instanceof RecordChangedError || !!error && typeof error === 'object' && 'code' in error && error.code === 'P2025';
}
