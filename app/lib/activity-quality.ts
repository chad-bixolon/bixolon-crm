// Activity types are configurable lookup records. Unknown/custom codes remain valid.
export function activityTypeHelp(type: string) {
  switch (type) {
    case 'CALL': return 'Log a completed call. Use the subject for a short summary; add an outcome when useful.';
    case 'MEETING': return 'Log a completed meeting at its start time. For a synced Calendar meeting, use Calendar Matches to keep it linked and avoid logging it twice.';
    case 'EMAIL': return 'Log an email that was sent or received. No meeting time or duration is needed; use the sent or received time. Linked inbound Support emails already appear on the Case.';
    case 'FOLLOW_UP': return 'Log a follow-up that already happened. For work still to do, create a Task; a follow-up date alone does not schedule one.';
    default: return 'Log a completed interaction. Use a short, specific subject so others can understand the work in reports.';
  }
}

export function defaultActivityType(types: { code: string }[]) {
  return types.some(type => type.code === 'CALL') ? 'CALL' : types.length === 1 ? types[0].code : '';
}

export function validateActivityOccurrence(date: Date, existingDate?: Date | null, now = new Date()) {
  if (!Number.isFinite(date.getTime())) return 'Choose a valid activity date and time.';
  // Preserve historical dates, including old planned Activities, on unrelated edits.
  if (date.toISOString().slice(0, 16) !== existingDate?.toISOString().slice(0, 16) && date.getTime() > now.getTime()) {
    return 'Activities record completed work. Choose a past or current activity date and time; use a Task for planned work.';
  }
  return null;
}
