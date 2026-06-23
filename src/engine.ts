import { VibePerksClient } from "./client"
import { RejectedError } from "./errors"
import { enqueue, loadQueue, saveQueue, type Store } from "./store"
import type { Impression } from "./types"

// Meta is the per-session adapter metadata attached to every impression.
export interface Meta {
  cli: string
  cliVersion: string
  pluginVersion: string
  sessionId: string
}

const FLUSH_RETRY_DELAY_MS = 200

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// buildImpression composes the wire payload for one displayed ad. Times are floored
// to non-negative integers and empty optionals are omitted so the backend treats
// them as absent.
export function buildImpression(token: string, displayedMs: number, meta: Meta): Impression {
  const ms = Math.max(0, Math.floor(displayedMs))
  return {
    impression_token: token,
    displayed_ms: ms,
    session_id: meta.sessionId || undefined,
    session_duration_ms: ms || undefined,
    plugin_version: meta.pluginVersion || undefined,
    cli: meta.cli || undefined,
    cli_version: meta.cliVersion || undefined,
  }
}

// recordView buffers an impression for a displayed ad, deduped by token. Empty
// tokens are ignored.
export async function recordView(
  store: Store,
  token: string,
  displayedMs: number,
  meta: Meta,
): Promise<void> {
  if (!token) return
  await enqueue(store, buildImpression(token, displayedMs, meta))
}

// postWithRetry attempts a single impression post with at most one bounded retry,
// and only for transient failures. Permanent outcomes (success, RejectedError,
// UnauthorizedError) return/throw immediately without retrying.
async function postWithRetry(client: VibePerksClient, imp: Impression): Promise<void> {
  try {
    await client.postImpression(imp)
  } catch (e) {
    if (e instanceof RejectedError) throw e
    if (e instanceof Error && e.name === "UnauthorizedError") throw e
    await delay(FLUSH_RETRY_DELAY_MS)
    await client.postImpression(imp)
  }
}

// flush posts every buffered impression. Delivered and permanently rejected
// impressions are dropped; transient failures are kept for the next flush. The
// first transient error (if any) propagates after the buffer is rewritten so the
// boundary can log it.
export async function flush(store: Store, client: VibePerksClient): Promise<void> {
  const queue = loadQueue(store)
  if (queue.length === 0) return
  const remaining: Impression[] = []
  let firstErr: unknown = null
  for (const imp of queue) {
    try {
      await postWithRetry(client, imp)
    } catch (e) {
      if (e instanceof RejectedError) continue
      remaining.push(imp)
      if (firstErr === null) firstErr = e
    }
  }
  await saveQueue(store, remaining)
  if (firstErr) throw firstErr
}
