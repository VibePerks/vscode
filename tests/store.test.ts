import { describe, expect, it } from "vitest"
import { enqueue, loadQueue, loadState, saveState, clearState, type Store } from "../src/store"
import type { Impression } from "../src/types"

function fakeStore(): Store & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  return {
    map,
    get: (k) => (map.has(k) ? JSON.parse(JSON.stringify(map.get(k))) : undefined),
    update: async (k, v) => {
      map.set(k, JSON.parse(JSON.stringify(v)))
    },
  }
}

function imp(token: string): Impression {
  return { impression_token: token, displayed_ms: 1000 }
}

describe("queue", () => {
  it("starts empty and appends impressions", async () => {
    const s = fakeStore()
    expect(loadQueue(s)).toEqual([])
    await enqueue(s, imp("a"))
    await enqueue(s, imp("b"))
    expect(loadQueue(s).map((e) => e.impression_token)).toEqual(["a", "b"])
  })

  it("dedupes by impression token", async () => {
    const s = fakeStore()
    await enqueue(s, imp("a"))
    await enqueue(s, imp("a"))
    expect(loadQueue(s)).toHaveLength(1)
  })
})

describe("state", () => {
  it("returns empty state when unset or malformed", () => {
    const s = fakeStore()
    expect(loadState(s)).toEqual({ ad: null, servedAt: 0 })
    s.map.set("vibeperks:state", { junk: true })
    expect(loadState(s)).toEqual({ ad: null, servedAt: 0 })
  })

  it("round-trips and clears state", async () => {
    const s = fakeStore()
    await saveState(s, { ad: null, servedAt: 1234 })
    expect(loadState(s).servedAt).toBe(1234)
    await clearState(s)
    expect(loadState(s)).toEqual({ ad: null, servedAt: 0 })
  })
})
