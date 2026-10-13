'use client';

import { useEffect, useRef, useState } from 'react';
import { EntityPicker, type PickerResult } from './entity-picker';

export function OptionalProjectFilter({ initial, none }: { initial: PickerResult | null; none: boolean }) {
  const [selected, setSelected] = useState(initial);
  const [noProject, setNoProject] = useState(none);
  const hidden = useRef<HTMLInputElement>(null);

  // The filter count and Saved Views read FormData from the parent form.
  // Notify them after React has updated the hidden projectId value.
  useEffect(() => { hidden.current?.dispatchEvent(new Event('change', { bubbles: true })); }, [selected, noProject]);

  return <div className="min-w-0">
    <input ref={hidden} type="hidden" name="projectId" value={noProject ? 'none' : selected?.id ?? ''}/>
    <EntityPicker type="project" label="Project" value={selected} onChange={project => {
      setSelected(project);
      if (project) setNoProject(false);
    }}/>
    <label className="mt-2 flex min-w-0 cursor-pointer items-start gap-2 text-sm leading-5 text-slate-700">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-orange-700" checked={noProject} onChange={event => {
        setNoProject(event.target.checked);
        if (event.target.checked) setSelected(null);
      }}/>
      <span>Show opportunities with no project</span>
    </label>
  </div>;
}
