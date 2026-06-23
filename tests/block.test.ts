// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderBlock, type AdRenderVars } from "../src/asset"

const VARS: AdRenderVars = {
  sentence: "Fast APIs - alchemy.com",
  domain: "alchemy.com",
  clickUrl: "https://alchemy.com",
  loopbackBase: "http://127.0.0.1:5599",
  token: "imp1",
  viewThresholdMs: 5000,
}

function blockFor(adapterId: string): string {
  const template = readFileSync(
    join(__dirname, "..", "src", "adapters", adapterId, "block.asset.js"),
    "utf8",
  )
  return renderBlock(template, VARS)
}

let pings: string[]
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  pings = []
  originalFetch = globalThis.fetch
  globalThis.fetch = ((url: string) => {
    pings.push(String(url))
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as unknown as typeof globalThis.fetch
  // Keep the dwell interval from lingering past the test.
  vi.spyOn(globalThis, "setInterval").mockReturnValue(
    0 as unknown as ReturnType<typeof setInterval>,
  )
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
  document.body.innerHTML = ""
})

function run(adapterId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(blockFor(adapterId))()
}

describe.each(["claude-code", "codex"])("injected block (%s)", (adapterId) => {
  it("rewrites the spinner verb into a clickable sponsor line", () => {
    const spinner = document.createElement("div")
    spinner.setAttribute("data-vibeperks-spinner", "")
    spinner.textContent = "Discombobulating..."
    document.body.appendChild(spinner)

    run(adapterId)

    const a = spinner.querySelector("a[data-vibeperks-ad]") as HTMLAnchorElement | null
    expect(a).not.toBeNull()
    expect(a!.textContent).toBe("Fast APIs - alchemy.com")
    expect(a!.getAttribute("href")).toContain("/vibeperks-ads/imp1/click?to=")
    expect(a!.getAttribute("href")).toContain(encodeURIComponent("https://alchemy.com"))
    expect(spinner.textContent).not.toContain("Discombobulating")
  })

  it("pings rendered + viewable when the spinner is already present", () => {
    const spinner = document.createElement("div")
    spinner.setAttribute("data-vibeperks-spinner", "")
    document.body.appendChild(spinner)

    run(adapterId)

    expect(pings.some((u) => u.includes("/impression_rendered"))).toBe(true)
    expect(pings.some((u) => u.includes("/impression_viewable"))).toBe(true)
  })

  it("emits a click ping when the sponsor line is clicked", () => {
    const spinner = document.createElement("div")
    spinner.setAttribute("data-vibeperks-spinner", "")
    document.body.appendChild(spinner)
    run(adapterId)

    const a = spinner.querySelector("a[data-vibeperks-ad]") as HTMLAnchorElement
    a.dispatchEvent(new Event("click"))
    expect(pings.some((u) => u.includes("/click"))).toBe(true)
  })

  it("does nothing and never throws when no spinner node exists", () => {
    expect(() => run(adapterId)).not.toThrow()
    expect(document.querySelector("[data-vibeperks-ad]")).toBeNull()
  })
})
