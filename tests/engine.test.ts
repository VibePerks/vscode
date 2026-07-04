import { describe, expect, it } from "vitest"
import { VibePerksClient, type FetchFn } from "../src/client"
import { buildImpression, flush, recordView, type Meta } from "../src/engine"
import { loadQueue, type Store } from "../src/store"
import type { Impression } from "../src/types"

const META: Meta = {
  cli: "vscode-claude-code",
  cliVersion: "1.2.3",
  pluginVersion: "0.1.0",
  sessionId: "s1",
}

function fakeStore(): Store {
  const map = new Map<string, unknown>()
  return {
    get: (k) => (map.has(k) ? JSON.parse(JSON.stringify(map.get(k))) : undefined),
    update: async (k, v) => {
      map.set(k, JSON.parse(JSON.stringify(v)))
    },
  }
}

// programmableClient drives a real VibePerksClient over a scripted fetch so the
// engine is exercised against the actual status mapping + retry.
function programmableClient() {
  const statuses: number[] = []
  const delivered: Impression[] = []
  let attempts = 0
  const fetch: FetchFn = async (_input, init) => {
    attempts++
    const status = statuses.shift() ?? 201
    if (status === 200 || status === 201) {
      delivered.push(JSON.parse(String(init?.body)) as Impression)
    }
    return new Response(JSON.stringify({}), { status })
  }
  return {
    client: new VibePerksClient("https://x", "tok", fetch),
    statuses,
    delivered,
    get attempts() {
      return attempts
    },
  }
}

describe("buildImpression", () => {
  it("floors negative/fractional ms and omits empty optionals", () => {
    const imp = buildImpression("tok", 1500.9, { ...META, sessionId: "" })
    expect(imp).toMatchObject({
      impression_token: "tok",
      displayed_ms: 1500,
      cli: "vscode-claude-code",
    })
    expect(imp.session_id).toBeUndefined()
  })
})

describe("recordView", () => {
  it("buffers a view deduped by token and ignores empty tokens", async () => {
    const store = fakeStore()
    await recordView(store, "tok", 4000, META)
    await recordView(store, "tok", 9000, META)
    await recordView(store, "", 1, META)
    expect(loadQueue(store)).toHaveLength(1)
    expect(loadQueue(store)[0]).toMatchObject({ impression_token: "tok", displayed_ms: 4000 })
  })
})

describe("flush", () => {
  it("delivers buffered impressions and empties the queue", async () => {
    const store = fakeStore()
    const h = programmableClient()
    await recordView(store, "a", 4000, META)
    await flush(store, h.client)
    expect(h.delivered).toHaveLength(1)
    expect(loadQueue(store)).toHaveLength(0)
  })

  it("drops permanently rejected impressions", async () => {
    const store = fakeStore()
    const h = programmableClient()
    h.statuses.push(422)
    await recordView(store, "a", 4000, META)
    await flush(store, h.client)
    expect(loadQueue(store)).toHaveLength(0)
    expect(h.delivered).toHaveLength(0)
  })

  it("keeps transient failures and retries once", async () => {
    const store = fakeStore()
    const h = programmableClient()
    h.statuses.push(503, 201) // first attempt fails transiently, retry succeeds
    await recordView(store, "a", 4000, META)
    await flush(store, h.client)
    expect(h.attempts).toBe(2)
    expect(h.delivered).toHaveLength(1)
    expect(loadQueue(store)).toHaveLength(0)
  })

  it("retains an impression that fails twice and re-throws", async () => {
    const store = fakeStore()
    const h = programmableClient()
    h.statuses.push(503, 503)
    await recordView(store, "a", 4000, META)
    await expect(flush(store, h.client)).rejects.toThrow()
    expect(loadQueue(store)).toHaveLength(1)
  })
})
