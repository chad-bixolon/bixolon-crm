'use client';
import { useState } from 'react';
import { EntityPicker, type PickerResult } from './entity-picker';

export function OptionalProjectFilter({ initial, none }: { initial: PickerResult | null; none: boolean }) {
  const [selected, setSelected] = useState(initial);
  const [noProject, setNoProject] = useState(none);
  return <div className="min-w-0"><input type="hidden" name="projectId" value={noProject ? 'none' : selected?.id ?? ''}/>{noProject ? <div className="filter-control flex items-center justify-between rounded border border-slate-300 bg-white px-3"><span>No Project</span><button type="button" className="text-orange-800 underline" onClick={() => setNoProject(false)}>Clear</button></div> : <EntityPicker type="project" label="Project" value={selected} onChange={setSelected}/>}{!noProject && !selected && <button type="button" className="mt-1 text-xs text-orange-800 underline" onClick={() => setNoProject(true)}>No Project</button>}</div>;
}
