import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_ROTATE_MS,
  rotateDelayMs,
  startRotation,
  type RotationTimers,
} from "../src/rotation"

// manualTimers drives rotation deterministically: only one timer is pending at a
// time (the loop schedules the next tick after each cycle), so tests fire it by
// hand and await the async tick to settle.
function manualTimers() {
  let pending: { fn: () => void; ms: number } | undefined
  let cleared = 0
  let nextId = 1
  const timers: RotationTimers = {
    set(fn, ms) {
      pending = { fn, ms }
      return nextId++ as unknown as ReturnType<typeof setTimeout>
    },
    clear() {
      cleared++
      pending = undefined
    },
  }
  // settle drains microtasks + one macrotask so the fired tick's awaited cycle
  // resolves and reschedules before we assert (real host setTimeout, not mocked).
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  return {
    timers,
    pendingMs: () => pending?.ms,
    isPending: () => pending !== undefined,
    clearedCount: () => cleared,
    async fire(): Promise<void> {
      const p = pending
      if (!p) throw new Error("no pending timer to fire")
      pending = undefined
      p.fn()
      await settle()
    },
  }
}

describe("rotateDelayMs", () => {
  it("uses the backend rotate_seconds when positive", () => {
    expect(rotateDelayMs(60)).toBe(60000)
    expect(rotateDelayMs(1)).toBe(1000)
  })

  it("falls back to the default cadence for missing/non-positive values", () => {
    expect(rotateDelayMs(undefined)).toBe(DEFAULT_ROTATE_MS)
    expect(rotateDelayMs(0)).toBe(DEFAULT_ROTATE_MS)
    expect(rotateDelayMs(-5)).toBe(DEFAULT_ROTATE_MS)
  })
})

describe("startRotation", () => {
  it("schedules the first tick at the initial delay without serving immediately", () => {
    const m = manualTimers()
    const cycle = vi.fn().mockResolvedValue(30000)
    startRotation({
      timers: m.timers,
      cycle,
      initialDelayMs: 5000,
      onError: vi.fn(),
      shouldContinue: () => true,
    })
    expect(m.pendingMs()).toBe(5000)
    expect(cycle).not.toHaveBeenCalled()
  })

  it("rotates on the cadence returned by each cycle", async () => {
    const m = manualTimers()
    const cycle = vi.fn().mockResolvedValueOnce(30000).mockResolvedValueOnce(45000)
    startRotation({
      timers: m.timers,
      cycle,
      initialDelayMs: 5000,
      onError: vi.fn(),
      shouldContinue: () => true,
    })
    await m.fire()
    expect(cycle).toHaveBeenCalledTimes(1)
    expect(m.pendingMs()).toBe(30000) // next delay comes from the served ad
    await m.fire()
    expect(cycle).toHaveBeenCalledTimes(2)
    expect(m.pendingMs()).toBe(45000)
  })

  it("keeps rotating after a failed cycle so a stale ad is never stuck", async () => {
    // The core fix: a transient serve/patch failure must not kill the loop. If it
    // did, the surface would freeze on the last ad forever (and keep showing it
    // even after every campaign is paused, never refreshing to the house ad).
    const m = manualTimers()
    const cycle = vi.fn().mockRejectedValueOnce(new Error("serve failed")).mockResolvedValue(20000)
    const onError = vi.fn()
    startRotation({
      timers: m.timers,
      cycle,
      initialDelayMs: 1000,
      onError,
      shouldContinue: () => true,
    })
    await m.fire()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(m.isPending()).toBe(true) // loop survived the error
    expect(m.pendingMs()).toBe(DEFAULT_ROTATE_MS) // recovers on the default cadence
    await m.fire()
    expect(cycle).toHaveBeenCalledTimes(2) // re-served -> stale/paused ad refreshed
  })

  it("stops without rescheduling once shouldContinue turns false (opt-out)", async () => {
    const m = manualTimers()
    const cycle = vi.fn().mockResolvedValue(20000)
    let active = true
    startRotation({
      timers: m.timers,
      cycle,
      initialDelayMs: 1000,
      onError: vi.fn(),
      shouldContinue: () => active,
    })
    active = false
    await m.fire()
    expect(cycle).not.toHaveBeenCalled()
    expect(m.isPending()).toBe(false)
  })

  it("stop() clears the pending tick and halts the loop", async () => {
    const m = manualTimers()
    const cycle = vi.fn().mockResolvedValue(20000)
    const handle = startRotation({
      timers: m.timers,
      cycle,
      initialDelayMs: 1000,
      onError: vi.fn(),
      shouldContinue: () => true,
    })
    handle.stop()
    expect(m.clearedCount()).toBe(1)
    expect(m.isPending()).toBe(false)
    expect(cycle).not.toHaveBeenCalled()
  })
})
