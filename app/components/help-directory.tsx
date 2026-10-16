"use client";

import Link from 'next/link';
import { useState } from 'react';
import { helpHref } from '@/lib/help/links';
import type { HelpTopicId, helpGroups } from '@/lib/help/topics';

type Topic = { id: HelpTopicId; title: string; summary: string; group: typeof helpGroups[number]; searchText: string };
export function HelpDirectory({ topics, groups }: { topics: Topic[]; groups: readonly string[] }) {
  const [query, setQuery] = useState('');
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = topics.filter(topic => words.every(word => topic.searchText.includes(word)));
  return <div>
    <div className="mb-7 max-w-xl"><label className="label" htmlFor="help-filter">Find a Help topic</label><input id="help-filter" type="search" className="field" placeholder="Try attachments, forecast, or follow-up" value={query} onChange={event => setQuery(event.target.value)} aria-describedby="help-results"/><p id="help-results" role="status" className="mt-2 text-sm text-slate-600">{matches.length} {matches.length === 1 ? 'topic' : 'topics'}{query.trim() ? ' found' : ' available for your role'}</p></div>
    {!matches.length && <p className="panel p-5">No topics match. Try a shorter phrase or clear the search.</p>}
    <div className="space-y-8">{groups.map(group => {
      const rows = matches.filter(topic => topic.group === group);
      return rows.length ? <section key={group} aria-label={group}><h2 className="mb-3 text-lg font-semibold">{group}</h2><ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map(topic => <li key={topic.id}><Link href={helpHref(topic.id)} className="panel block h-full rounded-lg p-5 hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-600"><h3 className="font-semibold text-orange-900">{topic.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{topic.summary}</p></Link></li>)}</ul></section> : null;
    })}</div>
  </div>;
}
