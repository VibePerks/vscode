import { afterEach, describe, expect, it } from "vitest"
import { start, type LoopbackEvent, type RunningLoopback } from "../src/loopback"

let running: RunningLoopback | undefined

afterEach(async () => {
  await running?.close()
  running = undefined
})

interface Recorded {
  token: string
  event: LoopbackEvent
  ms: number
}

async function startWith(allowed: string[] = []): Promise<{ base: string; events: Recorded[] }> {
  const events: Recorded[] = []
  running = await start({
    onEvent: (token, event, ms) => events.push({ token, event, ms }),
    isAllowedRedirect: (url) => allowed.includes(url),
  })
  return { base: running.base, events }
}

describe("loopback metric pings", () => {
  it("records a metric event with parsed ms and returns 204", async () => {
    const { base, events } = await startWith()
    const res = await fetch(`${base}/vibeperks-ads/imp1/view_threshold_met?ms=5200`)
    expect(res.status).toBe(204)
    expect(events).toEqual([{ token: "imp1", event: "view_threshold_met", ms: 5200 }])
  })

  it("rejects an unknown event path with 404", async () => {
    const { base, events } = await startWith()
    expect((await fetch(`${base}/vibeperks-ads/imp1/bogus`)).status).toBe(404)
    expect((await fetch(`${base}/other/path`)).status).toBe(404)
    expect(events).toHaveLength(0)
  })
})

describe("loopback click redirect", () => {
  it("302-redirects to an allow-listed http(s) target and records the click", async () => {
    const target = "https://alchemy.com"
    const { base, events } = await startWith([target])
    const res = await fetch(`${base}/vibeperks-ads/imp1/click?to=${encodeURIComponent(target)}`, {
      redirect: "manual",
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(target)
    expect(events).toEqual([{ token: "imp1", event: "click", ms: 0 }])
  })

  it("refuses a non-allow-listed target (open-redirect guard)", async () => {
    const { base, events } = await startWith(["https://alchemy.com"])
    const res = await fetch(
      `${base}/vibeperks-ads/imp1/click?to=${encodeURIComponent("https://evil.example")}`,
      { redirect: "manual" },
    )
    expect(res.status).toBe(400)
    expect(events).toHaveLength(0)
  })

  it("refuses a non-http(s) scheme", async () => {
    const { base } = await startWith(["file:///etc/passwd"])
    const res = await fetch(
      `${base}/vibeperks-ads/imp1/click?to=${encodeURIComponent("file:///etc/passwd")}`,
      { redirect: "manual" },
    )
    expect(res.status).toBe(400)
  })
})
