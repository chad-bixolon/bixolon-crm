'use client';

import { useState } from 'react';
import { selectedClosePeriod, type ClosePeriodInput } from '@/lib/close-period';

export function OpportunityClosePeriod({ initial, nearby }: { initial: ClosePeriodInput; nearby: string[] }) {
  const [period, setPeriod] = useState(selectedClosePeriod(initial));
  const [from, setFrom] = useState(initial.closeFrom ?? '');
  const [through, setThrough] = useState(initial.closeTo ?? '');
  const quarters = nearby.includes(period) || !/^20\d{2}-Q[1-4]$/.test(period) ? nearby : [period, ...nearby];
  const control = 'field filter-control';
  return <>
    <div><label className="label" htmlFor="closePeriod">Expected Close Period</label><select className={control} id="closePeriod" name="closePeriod" value={period} onChange={event => {
      const value = event.target.value;
      setPeriod(value);
      if (value !== 'custom') { setFrom(''); setThrough(''); }
    }}><option value="">All dates</option><option value="current-quarter">Current Quarter</option><option value="next-quarter">Next Quarter</option><option value="previous-quarter">Previous Quarter</option>{quarters.map(value => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}<option value="custom">Custom Date Range</option></select></div>
    {period === 'custom' && <>
      <div><label className="label" htmlFor="closeFrom">Expected Close Date From</label><input className={control} type="date" id="closeFrom" name="closeFrom" value={from} onChange={event => setFrom(event.target.value)}/></div>
      <div><label className="label" htmlFor="closeTo">Expected Close Date Through</label><input className={control} type="date" id="closeTo" name="closeTo" value={through} onChange={event => setThrough(event.target.value)}/></div>
    </>}
  </>;
}
