import type { Ad, Impression } from "./types"

// Store is the minimal key/value contract the engine needs. A VS Code Memento
// (ExtensionContext.globalState) satisfies it directly: get is synchronous, update
// returns a thenable. Tests pass an in-memory fake. Values round-trip through the
// host's JSON-serializable storage.
export interface Store {
  get(key: string): unknown
  update(key: string, value: unknown): PromiseLike<void>
}

// AdState is the cached current ad plus the epoch-ms it started showing. The status
// bar renders it immediately on serve.
export interface AdState {
  ad: Ad | null
  servedAt: number
}

const STATE_KEY = "vibeperks:state"
const QUEUE_KEY = "vibeperks:queue"

const EMPTY_STATE: AdState = { ad: null, servedAt: 0 }

function isAdState(v: unknown): v is AdState {
  return typeof v === "object" && v !== null && "servedAt" in v
}

// loadState reads the cached state; anything missing or malformed yields the empty
// state (no ad).
export function loadState(store: Store): AdState {
  const v = store.get(STATE_KEY)
  return isAdState(v) ? v : { ...EMPTY_STATE }
}

export async function saveState(store: Store, s: AdState): Promise<void> {
  await store.update(STATE_KEY, s)
}

export async function clearState(store: Store): Promise<void> {
  await store.update(STATE_KEY, { ...EMPTY_STATE })
}

export function loadQueue(store: Store): Impression[] {
  const v = store.get(QUEUE_KEY)
  return Array.isArray(v) ? (v as Impression[]) : []
}

export async function saveQueue(store: Store, q: Impression[]): Promise<void> {
  await store.update(QUEUE_KEY, q)
}

// enqueue appends an impression, deduped by impression token so a record repeated
// across the active + idle hooks for the same ad is stored once.
export async function enqueue(store: Store, imp: Impression): Promise<void> {
  const q = loadQueue(store)
  if (q.some((e) => e.impression_token === imp.impression_token)) return
  await saveQueue(store, [...q, imp])
}
