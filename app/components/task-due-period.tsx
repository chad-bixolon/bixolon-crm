'use client';

import { useState, useSyncExternalStore } from 'react';
import { selectedTaskDuePeriod, taskDuePeriods, type TaskDuePeriodInput } from '@/lib/task-due-period';

const subscribe = () => () => {};
const ready = () => true;
const serverReady = () => false;

export function TaskDuePeriod({ initial, label = 'Due date' }: { initial: TaskDuePeriodInput; label?: string }) {
  // A native select can otherwise change before its React handler is attached,
  // leaving the selected period and the conditional custom inputs out of sync.
  const hydrated = useSyncExternalStore(subscribe, ready, serverReady);
  const [period, setPeriod] = useState(selectedTaskDuePeriod(initial));
  const [from, setFrom] = useState(initial.dueFrom ?? '');
  const [through, setThrough] = useState(initial.dueTo ?? '');
  const description = period === 'overdue' ? 'Before today in Eastern time.'
    : period === 'today' ? 'Today in Eastern time.'
    : period === 'next-7-days' ? 'Today through 7 days from today, inclusive, in Eastern time.'
    : period === 'this-week' ? 'Monday through Sunday of this week in Eastern time.' : '';
  return <>
    <div>
      <label className="label" htmlFor="duePeriod">{label}</label>
      <select className="field filter-control" id="duePeriod" name="duePeriod" value={period} disabled={!hydrated} aria-describedby={description ? 'due-period-help' : undefined} onChange={event => {
        const value = event.target.value;
        setPeriod(value);
        if (value !== 'custom') { setFrom(''); setThrough(''); }
      }}>
        <option value="">Any due date</option>
        {taskDuePeriods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        <option value="custom">Custom date / range</option>
      </select>
      {!hydrated && <input type="hidden" name="duePeriod" value={period}/>}
      {description && <p id="due-period-help" className="mt-1 text-xs text-slate-500">{description} Completed Tasks appear only when Status is Completed.</p>}
    </div>
    {period === 'custom' && <>
      <div><label className="label" htmlFor="dueFrom">Due Date From</label><input className="field filter-control" type="date" id="dueFrom" name="dueFrom" value={from} onChange={event => setFrom(event.target.value)}/></div>
      <div><label className="label" htmlFor="dueTo">Due Date Through</label><input className="field filter-control" type="date" id="dueTo" name="dueTo" value={through} onChange={event => setThrough(event.target.value)}/></div>
    </>}
  </>;
}
