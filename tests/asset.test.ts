import { describe, expect, it } from "vitest"
import { renderBlock, blockAssetPath } from "../src/asset"

const VARS = {
  sentence: "Fast APIs - alchemy.com",
  domain: "alchemy.com",
  clickUrl: "https://alchemy.com",
  loopbackBase: "http://127.0.0.1:5599",
  token: "imp1",
  viewThresholdMs: 5000,
}

const TEMPLATE = [
  "var SENTENCE = __VIBEPERKS_AD_SENTENCE__",
  "var DOMAIN = __VIBEPERKS_AD_DOMAIN__",
  "var CLICK_URL = __VIBEPERKS_CLICK_URL__",
  "var LOOPBACK_BASE = __VIBEPERKS_LOOPBACK_BASE__",
  "var TOKEN = __VIBEPERKS_TOKEN__",
  "var VIEW_THRESHOLD_MS = __VIBEPERKS_VIEW_THRESHOLD_MS__",
].join("\n")

describe("renderBlock", () => {
  it("substitutes string values as safe JS literals", () => {
    const out = renderBlock(TEMPLATE, VARS)
    expect(out).toContain('var SENTENCE = "Fast APIs - alchemy.com"')
    expect(out).toContain('var CLICK_URL = "https://alchemy.com"')
    expect(out).toContain('var TOKEN = "imp1"')
  })

  it("embeds the threshold as a bare number", () => {
    expect(renderBlock(TEMPLATE, VARS)).toContain("var VIEW_THRESHOLD_MS = 5000")
  })

  it("leaves no placeholders behind", () => {
    expect(renderBlock(TEMPLATE, VARS)).not.toContain("__VIBEPERKS_")
  })

  it("escapes a sentence containing quotes/backslashes so the JS stays valid", () => {
    const out = renderBlock(TEMPLATE, { ...VARS, sentence: 'say "hi" \\ bye' })
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`${out}\nreturn SENTENCE`)
    expect(fn()).toBe('say "hi" \\ bye')
  })
})

describe("blockAssetPath", () => {
  it("resolves the per-adapter asset under src/adapters/<id>", () => {
    const p = blockAssetPath("/ext", "claude-code")
    expect(p.replace(/\\/g, "/")).toBe("/ext/src/adapters/claude-code/block.asset.js")
  })
})
