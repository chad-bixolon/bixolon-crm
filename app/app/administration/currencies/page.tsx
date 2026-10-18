import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { companyCurrency } from '@/lib/company-currency';
import { supportedCurrencies } from '@/lib/currency-configuration';
import { currencyAction } from './actions';

export default async function CurrencySettings({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requirePermission('users.manage');
  const [config, params] = await Promise.all([companyCurrency(), searchParams]);
  const available = supportedCurrencies().filter(currency => !config.currencies.some(row => row.code === currency.code));
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Currency Settings" description="Choose the currencies available to your company." action={<Link href="/administration" className="btn-secondary">Administration</Link>}/>
    {params.error && <p role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-800">{params.error}</p>}
    {params.saved && <p role="status" className="mb-4 rounded bg-green-50 p-3">Currency settings saved.</p>}
    <p className="mb-4 text-sm text-slate-600">New entries use the default currency. With one active currency, unnecessary currency controls are hidden. SalesHub does not convert currencies automatically. Deactivated currencies remain on existing records and in history.</p>
    <div className="panel overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Currency', 'Code', 'Status', 'Default', 'Actions'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{config.currencies.map(currency => <tr key={currency.code} className="border-t"><td className="p-3">{currency.name}</td><td className="p-3">{currency.code}</td><td className="p-3">{currency.active ? 'Active' : 'Inactive'}</td><td className="p-3">{currency.isDefault ? 'Default' : '—'}</td><td className="p-3"><div className="flex flex-wrap gap-2">{(!currency.isDefault ? [currency.active ? ['deactivate', 'Deactivate'] : ['activate', 'Activate'], ...(currency.active ? [['default', 'Set as default']] : [])] : []).map(([action, label]) => <form action={currencyAction} key={action}><input type="hidden" name="code" value={currency.code}/><button className="btn-secondary" name="action" value={action}>{label}</button></form>)}</div></td></tr>)}</tbody></table></div>
    {available.length > 0 && <form action={currencyAction} className="panel mt-5 flex flex-wrap items-end gap-3 p-4"><label className="label">Currency<select className="field" name="code">{available.map(currency => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}</select></label><button className="btn-primary" name="action" value="add">Add currency</button></form>}
    <p className="mt-3 text-sm text-slate-600">To deactivate the default currency, activate another currency and set it as default first. Changing the default preserves all existing amounts and currencies.</p>
  </Content>;
}
