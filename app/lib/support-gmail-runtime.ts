import { AsyncLocalStorage } from 'node:async_hooks';
import { isSupportGmailRateLimit } from './support-gmail-errors';

type Workflow = 'inbox' | 'ignore' | 'restore' | 'link' | 'create-review' | 'create-save' | 'file-review' | 'file-import';
const workflow = new AsyncLocalStorage<Workflow>();
export function gmailWorkflow<T>(name: Workflow, run: () => Promise<T>) { return workflow.run(workflow.getStore() ?? name, run); }
export const GMAIL_BUSY = 'Support Gmail is busy. Please try again in a moment.';
const PROVIDER_BUSY = 'Support Gmail is rate limited. Try again later.';
type State = { active: number; expensive: boolean; starts: number[]; requests: number[]; cooldown: number; retrying: boolean; touched: number };
type Entry = { expires: number; value: unknown };

// Per-process optimization only. No credentials, tokens, full messages or file
// contents are retained here. DB connection identity is checked before every use.
export class SupportGmailRuntime {
  private states = new Map<string, State>();
  private pending = new Map<string, Promise<unknown>>();
  private cache = new Map<string, Entry>();
  constructor(private readonly now = Date.now, private readonly sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), private readonly random = Math.random) {}
  private state(mailbox: string) {
    const now = this.now();
    for (const [key, state] of this.states) if (!state.active && state.cooldown <= now && now - state.touched > 60000) this.states.delete(key);
    let state = this.states.get(mailbox);
    if (!state) { state = { active: 0, expensive: false, starts: [], requests: [], cooldown: 0, retrying: false, touched: now }; this.states.set(mailbox, state); }
    state.touched = now;
    state.starts = state.starts.filter(at => at > now - 10000);
    state.requests = state.requests.filter(at => at > now - 10000);
    return state;
  }
  private event(event: string, requests = 0) {
    // Fixed labels and counts only: never mailbox IDs, URLs, errors or payloads.
    console.info(`[Support Gmail] workflow=${workflow.getStore() ?? 'inbox'} event=${event} requests=${requests}`);
  }
  async run<T>(mailbox: string, connection: string, operation: string, expensive: boolean, ttl: number, read: () => Promise<T>): Promise<T> {
    const now = this.now();
    for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key);
    const key = JSON.stringify([mailbox, connection, operation]);
    const cached = this.cache.get(key);
    if (cached) { this.event('cache-hit'); return structuredClone(cached.value) as T; }
    const pending = this.pending.get(key);
    if (pending) { this.event('coalesced'); return structuredClone(await pending) as T; }
    const state = this.state(mailbox);
    if (state.cooldown > now) throw new Error(PROVIDER_BUSY);
    if (state.active >= 3 || (expensive && state.expensive) || state.starts.length >= 60) {
      this.event('local-throttle'); throw new Error(GMAIL_BUSY);
    }
    state.active++; state.starts.push(now);
    if (expensive) state.expensive = true;
    // Install the promise synchronously before read can start another request.
    const job = Promise.resolve().then(read).then(value => {
      if (ttl > 0) {
        if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: this.now() + ttl, value: structuredClone(value) });
      }
      return value;
    }).finally(() => { this.pending.delete(key); state.active--; if (expensive) state.expensive = false; });
    this.pending.set(key, job);
    return structuredClone(await job);
  }
  async request(mailbox: string, safeRead: boolean, send: () => Promise<Response>, check: (response: Response) => Promise<never>): Promise<Response> {
    let retryState: State | undefined;
    try {
      for (let attempt = 0; ; attempt++) {
        const state = this.state(mailbox);
        if (state.cooldown > this.now()) throw new Error(PROVIDER_BUSY);
        if (state.requests.length >= 300) { this.event('local-throttle'); throw new Error(GMAIL_BUSY); }
        state.requests.push(this.now()); this.event('request', 1);
        const response = await send();
        if (response.ok || response.status === 404) return response;
        try { await check(response); }
        catch (error) {
          if (!isSupportGmailRateLimit(error)) throw error;
          this.event('provider-rate-limit');
          const delay = Math.max(error.retryAfterMs ?? 0, 1000 + Math.floor(this.random() * 250));
          state.cooldown = Math.max(state.cooldown, this.now() + delay);
          // Only GETs retry, once, and only if Google's minimum fits a short wait.
          // The mailbox cooldown blocks other operations from making retry storms.
          if (!safeRead || attempt >= 1 || delay > 2000 || state.retrying) throw error;
          this.event('retry');
          state.retrying = true; retryState = state;
          await this.sleep(delay);
        }
      }
    } finally { if (retryState) retryState.retrying = false; }
  }
}
const shared = globalThis as typeof globalThis & { supportGmailRuntime?: SupportGmailRuntime };
export const supportGmailRuntime = shared.supportGmailRuntime ??= new SupportGmailRuntime();
