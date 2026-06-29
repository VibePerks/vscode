import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

// AdapterTarget describes one foreign extension whose webview spinner we patch.
// `knownVersions` is the version allow-list (the version gate): we only ever
// inject into bundles whose extension version we have verified, so an unexpected
// release can never get a blind, possibly-breaking patch.
export interface AdapterTarget {
  id: string // "claude-code" | "codex" (also the block.asset.js folder name)
  cli: string // impression `cli` value reported to the backend
  extensionPrefix: string // installed extension folder prefix
  webviewRelPath: string // webview bundle path relative to the extension dir
  envOverride: string // env var to force a target bundle path (testing)
  knownVersions: ReadonlySet<string>
}

// ADAPTERS is the registry of webview-patch targets shipped by this extension.
export const ADAPTERS: readonly AdapterTarget[] = [
  {
    id: "claude-code",
    cli: "vscode-claude-code",
    extensionPrefix: "anthropic.claude-code-",
    webviewRelPath: "webview/index.js",
    envOverride: "VIBEPERKS_CC_TARGET",
    // Populated as releases are verified; empty until a build is hand-checked.
    knownVersions: new Set<string>(),
  },
  {
    id: "codex",
    cli: "vscode-codex",
    extensionPrefix: "openai.chatgpt-",
    webviewRelPath: "webview/index.js",
    envOverride: "VIBEPERKS_CODEX_TARGET",
    knownVersions: new Set<string>(),
  },
]

// TargetLocation is a resolved bundle ready to patch.
export interface TargetLocation {
  bundlePath: string
  version: string
}

// compareVersions orders dotted numeric versions (e.g. "1.10.0" > "1.9.0").
// Non-numeric segments compare lexically as a fallback so it never throws.
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".")
  const pb = b.split(".")
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const sa = pa[i] ?? ""
    const sb = pb[i] ?? ""
    const na = Number(sa)
    const nb = Number(sb)
    if (Number.isInteger(na) && Number.isInteger(nb)) {
      if (na !== nb) return na - nb
    } else if (sa !== sb) {
      return sa < sb ? -1 : 1
    }
  }
  return 0
}

// locate finds the newest installed extension matching the target prefix and
// returns its webview bundle path + version. An env override forces a specific
// bundle (used in tests/Remote). Returns null when nothing matches or the bundle
// file is absent.
export function locate(
  target: AdapterTarget,
  extensionsDir: string,
  env: Record<string, string | undefined>,
): TargetLocation | null {
  const override = env[target.envOverride]
  if (override) {
    return existsSync(override) ? { bundlePath: override, version: "override" } : null
  }
  if (!existsSync(extensionsDir)) return null
  const matches = readdirSync(extensionsDir)
    .filter((name) => name.startsWith(target.extensionPrefix))
    .map((name) => ({ name, version: name.slice(target.extensionPrefix.length) }))
    .sort((x, y) => compareVersions(y.version, x.version))
  for (const m of matches) {
    const bundlePath = join(extensionsDir, m.name, ...target.webviewRelPath.split("/"))
    if (existsSync(bundlePath)) return { bundlePath, version: m.version }
  }
  return null
}

// isSupportedVersion enforces the version gate. An env-override target ("override")
// is always allowed; otherwise the version must be in the allow-list.
export function isSupportedVersion(target: AdapterTarget, version: string): boolean {
  if (version === "override") return true
  return target.knownVersions.has(version)
}
