'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

export function LocalFetchTime({ iso }: { iso: string }) {
  const display = useSyncExternalStore(subscribe, () => new Date(iso).toLocaleString(), () => 'Loading local time…');
  return <time dateTime={iso}>{display}</time>;
}
