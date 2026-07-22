import { readFileSync } from "node:fs"
import { join } from "node:path"

// AdRenderVars are the values substituted into a block.asset.js template at patch
// time. Strings are embedded as JS string literals (JSON-escaped); the numeric
// threshold is embedded as a bare number.
export interface AdRenderVars {
  sentence: string
  domain: string
  clickUrl: string
  loopbackBase: string
  token: string
  viewThresholdMs: number
}

// Placeholders are bare tokens that sit exactly where a JS literal goes in the
// asset (e.g. `var SENTENCE = __VIBEPERKS_AD_SENTENCE__`).
const STR_PLACEHOLDERS: Record<string, keyof AdRenderVars> = {
  __VIBEPERKS_AD_SENTENCE__: "sentence",
  __VIBEPERKS_AD_DOMAIN__: "domain",
  __VIBEPERKS_CLICK_URL__: "clickUrl",
  __VIBEPERKS_LOOPBACK_BASE__: "loopbackBase",
  __VIBEPERKS_TOKEN__: "token",
}

// jsStr embeds an arbitrary (already control-stripped) string as a safe JS literal.
function jsStr(value: string): string {
  return JSON.stringify(value)
}

// blockAssetPath resolves a built-in adapter's injected-block template. `root` is
// the extension install dir (`context.extensionPath`); tests pass the source dir.
export function blockAssetPath(root: string, adapterId: string): string {
  return join(root, "src", "adapters", adapterId, "block.asset.js")
}

// renderBlock substitutes the ad values into a block template, producing the
// final JS injected into the host webview bundle.
export function renderBlock(template: string, vars: AdRenderVars): string {
  let out = template
  for (const [placeholder, key] of Object.entries(STR_PLACEHOLDERS)) {
    out = out.split(placeholder).join(jsStr(String(vars[key])))
  }
  const threshold = String(Math.max(0, Math.floor(vars.viewThresholdMs)))
  out = out.split("__VIBEPERKS_VIEW_THRESHOLD_MS__").join(threshold)
  return out
}

// loadAndRenderBlock reads an adapter's block template and renders it in one step.
export function loadAndRenderBlock(root: string, adapterId: string, vars: AdRenderVars): string {
  const template = readFileSync(blockAssetPath(root, adapterId), "utf8")
  return renderBlock(template, vars)
}
