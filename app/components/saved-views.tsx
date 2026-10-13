import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/current-user';
import { canUseSavedViews, normalizeSavedQuery, savedQueryHref, type SavedViewRoute } from '@/lib/saved-views';
import { listSavedViews } from '@/lib/saved-view-store';
import { SavedViewControl } from './saved-view-control';

export async function SavedViews({ routeKey, query }: { routeKey: SavedViewRoute; query: Record<string, string | undefined> }) {
  const actor = await currentUser();
  if (!canUseSavedViews(actor, routeKey)) return null;
  const views = await listSavedViews(routeKey, actor);
  if (!Object.values(query).some(value => value !== undefined)) {
    const defaultView = views.find(view => view.isDefault);
    if (defaultView && Object.keys(defaultView.query).length) redirect(savedQueryHref(routeKey, defaultView.query));
  }
  const initialQuery = normalizeSavedQuery(routeKey, query);
  return <SavedViewControl key={JSON.stringify(initialQuery)} routeKey={routeKey} initialViews={views}/>;
}
