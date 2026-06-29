import * as vscode from "vscode"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { ADAPTERS, type AdapterTarget, isSupportedVersion, locate } from "./adapters/registry"
import { loadAndRenderBlock } from "./asset"
import { VibePerksClient } from "./client"
import { loadConfig, type PluginConfig } from "./config"
import { flush, recordView, type Meta } from "./engine"
import { start as startLoopback, type LoopbackEvent, type RunningLoopback } from "./loopback"
import { patch, restore } from "./patcher"
import { clearState, type Store } from "./store"
import type { Ad } from "./types"

const PLUGIN_VERSION = "0.1.0"
const DEFAULT_VIEW_THRESHOLD_MS = 5000
const DEFAULT_ROTATE_MS = 20000
const SIGN_IN_URL = "https://vibeperks.ai/install"

// Per-adapter runtime state: the located bundle, the current ad, and its timers.
interface Surface {
  target: AdapterTarget
  bundlePath: string
  version: string
  supported: boolean
  ad: Ad | null
  rotateTimer?: ReturnType<typeof setTimeout>
}

// Module-level handles so commands and deactivate can reach the live state. The
// extension host is single-instance per window, so this is safe.
let output: vscode.OutputChannel
let statusBar: vscode.StatusBarItem
let loopback: RunningLoopback | undefined
const surfaces = new Map<string, Surface>()
const clickTargets = new Map<string, string>() // impression token -> allowed redirect URL

// log is the only place errors surface; the boundary swallows everything else.
function log(message: string, err?: unknown): void {
  const suffix = err instanceof Error ? `: ${err.message}` : err ? `: ${String(err)}` : ""
  output.appendLine(`[vibeperks] ${message}${suffix}`)
}

function meta(target: AdapterTarget): Meta {
  return {
    cli: target.cli,
    cliVersion: "",
    pluginVersion: PLUGIN_VERSION,
    sessionId: "",
  }
}

function clickUrlFor(ad: Ad): string {
  const domain = ad.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")
  return domain ? `https://${domain}` : "https://vibeperks.ai"
}

// extensionsDir resolves the directory holding installed extensions. We prefer the
// real path of an installed target via the VS Code API, falling back to the
// conventional ~/.vscode/extensions folder.
function extensionsDir(): string {
  for (const t of ADAPTERS) {
    for (const ext of vscode.extensions.all) {
      if (ext.id.toLowerCase().startsWith(t.extensionPrefix.replace(/-$/, "").toLowerCase())) {
        return join(ext.extensionPath, "..")
      }
    }
  }
  const home = process.env.HOME || process.env.USERPROFILE || ""
  return join(home, ".vscode", "extensions")
}

// serveAndPatch fetches a fresh ad and injects it into the surface's bundle. With
// no ad available it leaves the bundle pristine (restores any prior patch).
async function serveAndPatch(
  context: vscode.ExtensionContext,
  client: VibePerksClient,
  surface: Surface,
): Promise<void> {
  const ad = await client.serve()
  surface.ad = ad
  if (!ad || !loopback) {
    restore(surface.bundlePath)
    return
  }
  clickTargets.set(ad.impression_token, clickUrlFor(ad))
  const block = loadAndRenderBlock(context.extensionPath, surface.target.id, {
    sentence: ad.sentence,
    domain: ad.domain,
    clickUrl: clickUrlFor(ad),
    loopbackBase: loopback.base,
    token: ad.impression_token,
    viewThresholdMs: DEFAULT_VIEW_THRESHOLD_MS,
  })
  patch(surface.bundlePath, block)
}

function scheduleRotation(
  context: vscode.ExtensionContext,
  client: VibePerksClient,
  cfg: PluginConfig,
  surface: Surface,
): void {
  if (surface.rotateTimer) clearTimeout(surface.rotateTimer)
  const ms =
    surface.ad && surface.ad.rotate_seconds > 0
      ? surface.ad.rotate_seconds * 1000
      : DEFAULT_ROTATE_MS
  surface.rotateTimer = setTimeout(() => {
    void (async () => {
      try {
        if (cfg.optOut) return
        await serveAndPatch(context, client, surface)
        scheduleRotation(context, client, cfg, surface)
      } catch (e) {
        log(`rotation failed for ${surface.target.id}`, e)
      }
    })()
  }, ms)
  surface.rotateTimer.unref?.()
}

function updateStatusBar(cfg: PluginConfig, hasToken: boolean): void {
  const active = [...surfaces.values()].filter((s) => s.supported && s.ad).length
  const incompatible = [...surfaces.values()].some((s) => !s.supported)
  if (!hasToken) {
    statusBar.text = "$(rss) VibePerks: sign in"
    statusBar.tooltip = "Sign in to start earning. Click to open VibePerks."
  } else if (cfg.optOut) {
    statusBar.text = "$(rss) VibePerks: off"
    statusBar.tooltip = "Opted out (opt_out in ~/.vibeperks/config.json)."
  } else {
    statusBar.text = `$(rss) VibePerks${incompatible ? " (!)" : ""}`
    statusBar.tooltip = incompatible
      ? "Some panels are an unrecognized version and were left untouched."
      : `Active sponsor surfaces: ${active}`
  }
  statusBar.command = "vibeperks.menu"
  statusBar.show()
}

// restoreAll reverts every patched bundle byte-for-byte and clears timers.
function restoreAll(): void {
  for (const s of surfaces.values()) {
    if (s.rotateTimer) clearTimeout(s.rotateTimer)
    try {
      restore(s.bundlePath)
    } catch (e) {
      log(`restore failed for ${s.target.id}`, e)
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("VibePerks")
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  context.subscriptions.push(output, statusBar)

  // SINGLE fail-silent boundary: every command and async task below is wrapped so
  // a VibePerks error can never break or slow the host. No swallowing happens
  // deeper than this point (the loopback handler and the injected block have their
  // own narrow guards by necessity, documented at each site).
  void boot(context).catch((e) => log("activation failed", e))
}

async function boot(context: vscode.ExtensionContext): Promise<void> {
  const env = process.env as Record<string, string | undefined>
  const cfg = loadConfig(env)
  const client = new VibePerksClient(cfg.apiBase, cfg.deviceToken)
  const hasToken = cfg.deviceToken !== ""
  const store: Store = {
    get: (k) => context.globalState.get(k),
    update: (k, v) => context.globalState.update(k, v),
  }

  registerCommands(context)

  // Discover + version-gate the patch targets up front so the status bar is honest
  // even when we will not inject (no token / opted out / unknown version).
  const dir = extensionsDir()
  for (const target of ADAPTERS) {
    const loc = locate(target, dir, env)
    if (!loc) continue
    const supported = isSupportedVersion(target, loc.version)
    surfaces.set(target.id, {
      target,
      bundlePath: loc.bundlePath,
      version: loc.version,
      supported,
      ad: null,
    })
    if (!supported) log(`unrecognized ${target.id} version ${loc.version}; leaving it untouched`)
  }

  updateStatusBar(cfg, hasToken)

  if (!hasToken || cfg.optOut) {
    // No earning: ensure any leftover patch from a prior session is reverted.
    restoreAll()
    for (const s of surfaces.values()) s.ad = null
    await clearState(store)
    return
  }

  loopback = await startLoopback(makeLoopbackDeps(store, client))
  context.subscriptions.push({ dispose: () => void loopback?.close().catch(() => {}) })

  for (const surface of surfaces.values()) {
    if (!surface.supported) continue
    try {
      await serveAndPatch(context, client, surface)
      scheduleRotation(context, client, cfg, surface)
    } catch (e) {
      log(`initial patch failed for ${surface.target.id}`, e)
    }
  }
  updateStatusBar(cfg, hasToken)
}

// makeLoopbackDeps wires injected-block pings into the impression pipeline. Only a
// crossed view threshold (or a click) records a billable impression; it is deduped
// by token in the queue, then flushed with one bounded retry (engine semantics).
function makeLoopbackDeps(store: Store, client: VibePerksClient) {
  function targetFor(token: string): AdapterTarget | undefined {
    for (const s of surfaces.values()) if (s.ad?.impression_token === token) return s.target
    return undefined
  }
  return {
    onEvent(token: string, event: LoopbackEvent, displayedMs: number): void {
      if (event !== "view_threshold_met" && event !== "click") return
      const target = targetFor(token)
      if (!target) return
      void (async () => {
        try {
          await recordView(store, token, displayedMs, meta(target))
          await flush(store, client)
        } catch (e) {
          log("impression flush failed", e)
        }
      })()
    },
    isAllowedRedirect(url: string): boolean {
      for (const allowed of clickTargets.values()) if (allowed === url) return true
      return false
    },
  }
}

function registerCommands(context: vscode.ExtensionContext): void {
  const cmd = (id: string, fn: () => void | Promise<void>) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => {
        void (async () => {
          try {
            await fn()
          } catch (e) {
            log(`command ${id} failed`, e)
            void vscode.window.showErrorMessage("VibePerks: command failed (see output).")
          }
        })()
      }),
    )

  cmd("vibeperks.signIn", async () => {
    await vscode.env.openExternal(vscode.Uri.parse(SIGN_IN_URL))
  })
  cmd("vibeperks.signOut", async () => {
    restoreAll()
    await vscode.window.showInformationMessage(
      "VibePerks: remove your device token from ~/.vibeperks/config.json to sign out.",
    )
  })
  cmd("vibeperks.restoreClaudeCode", () => {
    const s = surfaces.get("claude-code")
    if (s) restore(s.bundlePath)
  })
  cmd("vibeperks.restoreCodex", () => {
    const s = surfaces.get("codex")
    if (s) restore(s.bundlePath)
  })
  cmd("vibeperks.restoreAll", () => restoreAll())
  cmd("vibeperks.diagnose", async () => {
    output.show(true)
    log("diagnostics:")
    log(`  loopback: ${loopback ? loopback.base : "(not running)"}`)
    for (const s of surfaces.values()) {
      log(
        `  ${s.target.id}: version=${s.version} supported=${s.supported} ` +
          `patched=${existsSync(s.bundlePath)} ad=${s.ad ? s.ad.ad_id : "none"}`,
      )
    }
  })
  cmd("vibeperks.menu", async () => {
    const pick = await vscode.window.showQuickPick(
      ["Sign in", "Sign out", "Restore all patched panels", "Diagnose"],
      { placeHolder: "VibePerks" },
    )
    if (pick === "Sign in") await vscode.commands.executeCommand("vibeperks.signIn")
    else if (pick === "Sign out") await vscode.commands.executeCommand("vibeperks.signOut")
    else if (pick === "Restore all patched panels")
      await vscode.commands.executeCommand("vibeperks.restoreAll")
    else if (pick === "Diagnose") await vscode.commands.executeCommand("vibeperks.diagnose")
  })
}

export function deactivate(): void {
  try {
    restoreAll()
    void loopback?.close().catch(() => {})
  } catch {
    /* fail silent on shutdown */
  }
}
