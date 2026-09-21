'use client';

import { useState } from 'react';

type CloseDateFieldsProps = {
  initialChoice: string;
  initialFrom?: string;
  initialTo?: string;
};

export function ReportCloseDateFields({ initialChoice, initialFrom, initialTo }: CloseDateFieldsProps) {
  const [choice, setChoice] = useState(initialChoice);

  return <>
    <label className="label">Close Date
      <select className="field" name="closeDatePreset" value={choice} onChange={event => setChoice(event.target.value)}>
        <option value="ANY">Any</option>
        <option value="THIS_MONTH">This Month</option>
        <option value="THIS_QUARTER">This Quarter</option>
        <option value="NEXT_QUARTER">Next Quarter</option>
        <option value="THIS_YEAR">This Year</option>
        <option value="CUSTOM">Custom</option>
      </select>
    </label>
    {choice === 'CUSTOM' && <>
      <label className="label">Custom close from<input className="field" type="date" name="closeFrom" defaultValue={initialFrom}/></label>
      <label className="label">Custom close through<input className="field" type="date" name="closeTo" defaultValue={initialTo}/></label>
    </>}
  </>;
}
