"use client";
import { useSubmitGuard } from "@/lib/submit-guard";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { ForecastCategory, OpportunityPartyRole } from "@prisma/client";
import { submitOpportunity, type FormState } from "@/app/opportunities/actions";
import { forecastLabels, partyLabels } from "@/lib/crm-validation";
import type { LabelMap } from "@/lib/configuration";
import { opportunityPartyLabels } from "@/lib/crm-validation";
import { addParticipant, clearDraft, draftKey as opportunityDraftKey, persistDraft, removeParticipant, restoreDraft, setParticipantRoles, type OpportunityDraft } from "@/lib/opportunity-draft";
import { formatCurrency } from "@/lib/display-format";
import { ProductPicker } from "@/components/product-picker";

type Option = { id: number; name: string };
type Initial = { name: string; description: string | null; ownerId: number | null; projectIds: number[]; stageId: number; expectedCloseDate: Date | null; probability: number | null; forecastCategory: ForecastCategory | null; currencyCode: string; participants: { accountId: number; roles: OpportunityPartyRole[] }[]; lines: { id: number; productId: number; skuId: number | null; quantity: number; price: string }[] };
type Props = { id?: number; initial?: Initial; labels?: LabelMap; accounts: Option[]; projects: Option[]; productCategories: Option[]; owners: { id: number; firstName: string; lastName: string }[]; stages: { id: number; name: string; probability: number }[]; currencies: { code: string; name: string }[]; productCount: number };
function initialDraft(initial?: Initial): OpportunityDraft {
  return { name: initial?.name ?? "", description: initial?.description ?? "", ownerId: initial?.ownerId?.toString() ?? "", projectIds: initial?.projectIds ?? [], stageId: initial?.stageId?.toString() ?? "", expectedCloseDate: initial?.expectedCloseDate?.toISOString().slice(0, 10) ?? "", probability: initial?.probability?.toString() ?? "", forecastCategory: initial?.forecastCategory ?? "", currencyCode: initial?.currencyCode ?? "USD", participants: initial?.participants ?? [], lines: initial?.lines.map((line) => ({ ...line, quantity: String(line.quantity) })) ?? [] };
}
export function OpportunityForm({ id, initial, accounts, projects, productCategories, owners, stages, currencies, productCount, labels }: Props) {
  const participantLabels = labels ? opportunityPartyLabels(labels) : partyLabels;
  const router = useRouter();
  const draftKey = opportunityDraftKey(id);
  const [state, action, pending] = useActionState(submitOpportunity.bind(null, id ?? null), { errors: {} } as FormState);
  const guard = useSubmitGuard(state);
  const original = useRef(initialDraft(initial));
  const [draft, setDraft] = useState(() => initialDraft(initial));
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [savedLocally, setSavedLocally] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [participantMessage, setParticipantMessage] = useState("");
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDraft(restoreDraft(localStorage, draftKey, original.current));
      setHydratedKey(draftKey);
    });
    return () => { active = false; };
  }, [draftKey]);
  useEffect(() => {
    if (persistDraft(localStorage, draftKey, draft, hydratedKey)) queueMicrotask(() => setSavedLocally(true));
  }, [draft, draftKey, hydratedKey]);
  useEffect(() => { if (state.redirectTo) { clearDraft(localStorage, draftKey); router.push(state.redirectTo); } }, [state.redirectTo, draftKey, router]);
  const update = <K extends keyof OpportunityDraft>(key: K, value: OpportunityDraft[K]) => setDraft((old) => ({ ...old, [key]: value }));
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  const accountOptions = [...accounts]; for (const p of initial?.participants ?? []) if (!accountOptions.some((a) => a.id === p.accountId)) accountOptions.push({ id: p.accountId, name: `Account #${p.accountId} (inactive)` });
  const availableAccounts = accountOptions.filter((a) => !draft.participants.some((p) => p.accountId === a.id));
  const addAccount = () => { const accountId = Number(selectedAccount); if (!accountId) { setParticipantMessage("Choose an account to add."); return; } setDraft((old) => addParticipant(old, accountId)); setSelectedAccount(""); setParticipantMessage(""); };
  return <form action={action} onSubmit={guard} className="panel max-w-5xl space-y-7 p-6" aria-label={id ? "Edit opportunity" : "Create opportunity"}>
    {state.message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label" htmlFor="name">Opportunity name *</label><input className="field" id="name" name="name" required maxLength={200} value={draft.name} onChange={(e) => update("name", e.target.value)}/>{error("name")}</div>
      <div className="sm:col-span-2"><label className="label" htmlFor="description">Description</label><textarea className="field min-h-24" id="description" name="description" maxLength={5000} value={draft.description} onChange={(e) => update("description", e.target.value)}/>{error("description")}</div>
      <div><label className="label" htmlFor="ownerId">Owner</label><select className="field" id="ownerId" name="ownerId" value={draft.ownerId} onChange={(e) => update("ownerId", e.target.value)}><option value="">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}</option>)}{initial?.ownerId && !owners.some((o) => o.id === initial.ownerId) && <option value={initial.ownerId}>Current owner (inactive)</option>}</select>{error("ownerId")}{owners.length === 0 && <p className="mt-1 text-xs text-slate-500">No active users. Add one in Administration → Users, or leave unassigned.</p>}</div>
      <div><label className="label" htmlFor="stageId">Sales stage *</label><select className="field" id="stageId" name="stageId" required value={draft.stageId} onChange={(e) => update("stageId", e.target.value)}><option value="">Choose stage</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.probability}%</option>)}</select>{error("stageId")}{stages.length === 0 && <p className="mt-1 text-sm text-amber-800">No active stages. Run the default stage seed script.</p>}</div>
      <div><label className="label" htmlFor="expectedCloseDate">Expected close date</label><input className="field" type="date" id="expectedCloseDate" name="expectedCloseDate" value={draft.expectedCloseDate} onChange={(e) => update("expectedCloseDate", e.target.value)}/>{error("expectedCloseDate")}</div>
      <div><label className="label" htmlFor="probability">Probability override (%)</label><input className="field" type="number" min="0" max="100" step="1" id="probability" name="probability" value={draft.probability} onChange={(e) => update("probability", e.target.value)} placeholder="Use stage probability"/>{error("probability")}</div>
      <div><label className="label" htmlFor="forecastCategory">Forecast category</label><select className="field" id="forecastCategory" name="forecastCategory" value={draft.forecastCategory} onChange={(e) => update("forecastCategory", e.target.value as ForecastCategory | "")}><option value="">Unspecified</option>{Object.entries(forecastLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>{error("forecastCategory")}</div>
      <div><label className="label" htmlFor="currencyCode">Currency *</label><select className="field" id="currencyCode" name="currencyCode" required value={draft.currencyCode} onChange={(e) => update("currencyCode", e.target.value)}>{currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select>{error("currencyCode")}</div>
    </div>
    <section><h2 className="mb-3 text-lg font-semibold">Projects</h2>{error("projectIds")}
      <div className="flex flex-wrap items-end gap-2"><div className="min-w-60 flex-1"><label className="label" htmlFor="addProject">Existing Project</label><select className="field" id="addProject" value={selectedProject} onChange={e => setSelectedProject(e.target.value)}><option value="">Choose Project</option>{projects.filter(p => !draft.projectIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div><button type="button" className="btn-secondary" disabled={!selectedProject} onClick={() => { const projectId = Number(selectedProject); if (projectId && !draft.projectIds.includes(projectId)) update("projectIds", [...draft.projectIds, projectId]); setSelectedProject(""); }}>Link Project</button></div>
      {draft.projectIds.length ? <ul className="mt-3 space-y-2">{draft.projectIds.map(projectId => <li key={projectId} className="flex items-center justify-between gap-2 text-sm"><input type="hidden" name="projectIds" value={projectId}/><span>{projects.find(p => p.id === projectId)?.name ?? `Project #${projectId} (archived)`}</span><button type="button" className="btn-secondary" onClick={() => update("projectIds", draft.projectIds.filter(id => id !== projectId))}>Unlink</button></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No Projects linked.</p>}
    </section>
    <section><h2 className="mb-3 text-lg font-semibold">Participating accounts</h2><p className="mb-4 text-sm text-slate-600">Add the companies involved in this opportunity and select the role each company plays in this specific deal. These roles do not change the Account&apos;s normal business roles.</p>{error("participants")}
      <div className="mb-4 flex flex-wrap items-end gap-2"><div className="min-w-60 flex-1"><label className="label" htmlFor="addAccount">Existing account</label><select className="field" id="addAccount" value={selectedAccount} onChange={(e) => { setSelectedAccount(e.target.value); setParticipantMessage(""); }}><option value="">Choose account</option>{availableAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div><button type="button" className="btn-secondary" disabled={!availableAccounts.length} onClick={addAccount}>Add account</button></div>
      {participantMessage && <p role="alert" className="mb-3 text-sm text-red-700">{participantMessage}</p>}{!accounts.length && <p className="mb-3 text-sm text-slate-600">No active accounts are available. Add an account from Accounts first.</p>}
      <div className="space-y-4">{draft.participants.map((p) => <div key={p.accountId} className="rounded border border-slate-200 p-4"><div className="flex items-center justify-between gap-2"><strong>{accountOptions.find((a) => a.id === p.accountId)?.name ?? `Account #${p.accountId}`}</strong><button type="button" className="btn-secondary" onClick={() => setDraft((old) => removeParticipant(old, p.accountId))}>Remove account</button></div><input type="hidden" name="accountId" value={p.accountId}/><p className="mt-2 text-sm text-slate-600">Opportunity roles: {p.roles.map((role) => participantLabels[role]).join(", ") || "None selected"}</p><div className="mt-3 flex flex-wrap gap-3">{Object.entries(participantLabels).map(([role, label]) => <label key={role} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={p.roles.includes(role as OpportunityPartyRole)} onChange={(e) => setDraft((old) => setParticipantRoles(old, p.accountId, e.target.checked ? [...p.roles, role as OpportunityPartyRole] : p.roles.filter((r) => r !== role)))}/>{label}</label>)}</div><input type="hidden" name="participantRoles" value={p.roles.join(",")}/></div>)}</div>
    </section>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Opportunity products</h2>{productCount > 0 && <button type="button" className="btn-secondary" onClick={() => update("lines", [...draft.lines, { id: 0, productId: 0, skuId: 0, quantity: "1", price: "0.00" }])}>Add product</button>}</div>{error("lines")}
      {productCount === 0 && <p className="mb-3 rounded bg-slate-50 p-4 text-sm text-slate-600">No products are available. <Link className="text-orange-800 underline" href="/products">Add products from Products first.</Link></p>}
      <div className="space-y-3">{draft.lines.map((line, index) => <div key={line.id || `new-${index}`} className="grid gap-2 rounded border border-slate-200 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]"><input type="hidden" name="lineId" value={line.id || ""}/><ProductPicker categories={productCategories} index={index} productId={line.productId} skuId={line.skuId ?? 0} currencyCode={draft.currencyCode} price={line.price} onChange={(productId, skuId, price) => update("lines", draft.lines.map((item, i) => i === index ? { ...item, productId, skuId, price: price ?? item.price } : item))}/><input className="field" aria-label={`Quantity ${index + 1}`} name="quantity" type="number" min="1" step="1" value={line.quantity} onChange={(e) => update("lines", draft.lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))}/><input className="field" aria-label={`Estimated unit price ${index + 1}`} name="price" type="number" min="0" step="0.01" value={line.price} onChange={(e) => update("lines", draft.lines.map((item, i) => i === index ? { ...item, price: e.target.value } : item))}/><span className="self-center text-sm tabular-nums">{formatCurrency(Number(line.quantity) * Number(line.price || 0), draft.currencyCode)}</span><button type="button" className="btn-secondary" onClick={() => update("lines", draft.lines.filter((_, i) => i !== index))}>Remove</button></div>)}</div>{draft.lines.length > 0 && <p className="mt-2 text-xs text-slate-500">Removing a saved line archives it. Total uses unarchived lines only.</p>}
    </section><div className="flex items-center justify-between gap-2">{savedLocally && <span className="text-xs text-slate-500" role="status">Draft saved locally</span>}<div className="ml-auto flex gap-2"><Link className="btn-secondary" href={id ? `/opportunities/${id}` : "/opportunities"} onClick={() => clearDraft(localStorage, draftKey)}>Cancel</Link><button type="submit" className="btn-primary disabled:opacity-60" disabled={pending}>{pending ? "Saving…" : id ? "Save opportunity" : "Create opportunity"}</button></div></div>
  </form>;
}
