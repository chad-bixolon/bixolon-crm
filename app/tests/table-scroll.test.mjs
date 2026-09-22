import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { measureTableScroll, setTableScrollPosition, updateTableScrollPosition } from '../components/table-scroll-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('table scrolling updates the custom track position without a feedback write', () => {
  const current = measureTableScroll({ scrollLeft: 0, scrollWidth: 1000, clientWidth: 400 });
  const next = updateTableScrollPosition(current, 225);
  assert.deepEqual(next, { ...current, position: 225 });
  assert.equal(updateTableScrollPosition(next, 225), next, 'unchanged positions do not schedule another state value');
});

test('custom track movement updates and clamps the table scroll position', () => {
  const viewport = { scrollLeft: 0, scrollWidth: 1000, clientWidth: 400 };
  assert.equal(setTableScrollPosition(viewport, 275), 275);
  assert.equal(viewport.scrollLeft, 275);
  assert.equal(setTableScrollPosition(viewport, 900), 600);
  assert.equal(viewport.scrollLeft, 600);
});

test('no-overflow and zero-width layouts have finite hidden-track geometry', () => {
  for (const dimensions of [
    { scrollLeft: 10, scrollWidth: 400, clientWidth: 400 },
    { scrollLeft: 10, scrollWidth: 1000, clientWidth: 0 },
    { scrollLeft: Number.NaN, scrollWidth: Number.NaN, clientWidth: Number.NaN },
  ]) {
    const geometry = measureTableScroll(dimensions);
    assert.equal(geometry.max, 0);
    assert.equal(geometry.position, 0);
    assert.ok(Number.isFinite(geometry.thumb));
  }
});

test('geometry is recalculated safely after table data changes', () => {
  assert.deepEqual(
    measureTableScroll({ scrollLeft: 500, scrollWidth: 1200, clientWidth: 400 }),
    { max: 800, position: 500, thumb: 123 },
  );
  const filtered = measureTableScroll({ scrollLeft: 500, scrollWidth: 550, clientWidth: 400 });
  assert.deepEqual(filtered, { max: 150, position: 150, thumb: 268 });
  assert.ok(Object.values(filtered).every(Number.isFinite));
});

test('scroll handler captures DOM values before entering a deferred state updater', () => {
  const source = fs.readFileSync(path.join(root, 'components/table-scroll.tsx'), 'utf8');
  const handler = source.slice(source.indexOf('onScroll={event =>'), source.indexOf('className="report-table-viewport'));
  assert.match(handler, /const \{ scrollLeft, scrollWidth, clientWidth \} = event\.currentTarget;/);
  assert.doesNotMatch(handler, /setScroll\([^)]*event\.currentTarget/s);
});

test('sync directions are separate and cannot recursively write to one another', () => {
  const source = fs.readFileSync(path.join(root, 'components/table-scroll.tsx'), 'utf8');
  const scrollHandler = source.slice(source.indexOf('onScroll={event =>'), source.indexOf('className="report-table-viewport'));
  assert.doesNotMatch(scrollHandler, /setTableScrollPosition|\.scrollLeft\s*=/);

  const viewport = { scrollLeft: 40, scrollWidth: 1000, clientWidth: 400 };
  assert.equal(setTableScrollPosition(viewport, 40), 40);
  assert.equal(viewport.scrollLeft, 40, 'an already synchronized position is not changed');
});
