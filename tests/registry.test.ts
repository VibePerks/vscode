import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  ADAPTERS,
  compareVersions,
  isSupportedVersion,
  locate,
  type AdapterTarget,
} from "../src/adapters/registry"

const dirs: string[] = []

function extDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vibeperks-ext-"))
  dirs.push(dir)
  return dir
}

// install writes a fake extension folder with a webview bundle.
function install(root: string, folder: string, withBundle = true): string {
  const ext = join(root, folder)
  mkdirSync(join(ext, "webview"), { recursive: true })
  const bundle = join(ext, "webview", "index.js")
  if (withBundle) writeFileSync(bundle, "// bundle\n", "utf8")
  return bundle
}

const CC: AdapterTarget = {
  id: "claude-code",
  cli: "vscode-claude-code",
  extensionPrefix: "anthropic.claude-code-",
  webviewRelPath: "webview/index.js",
  envOverride: "VIBEPERKS_CC_TARGET",
  knownVersions: new Set(["1.2.0"]),
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe("compareVersions", () => {
  it("orders dotted numeric versions", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0)
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0)
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0)
  })
})

describe("locate", () => {
  it("returns null when the extensions dir is missing", () => {
    expect(locate(CC, join(tmpdir(), "nope-vibeperks"), {})).toBeNull()
  })

  it("returns null when no extension matches", () => {
    const root = extDir()
    install(root, "openai.chatgpt-1.0.0")
    expect(locate(CC, root, {})).toBeNull()
  })

  it("picks the newest matching extension with a present bundle", () => {
    const root = extDir()
    install(root, "anthropic.claude-code-1.1.0")
    const newest = install(root, "anthropic.claude-code-1.2.0")
    const loc = locate(CC, root, {})
    expect(loc?.bundlePath).toBe(newest)
    expect(loc?.version).toBe("1.2.0")
  })

  it("skips a matching extension whose bundle is absent", () => {
    const root = extDir()
    install(root, "anthropic.claude-code-2.0.0", false)
    const older = install(root, "anthropic.claude-code-1.2.0")
    expect(locate(CC, root, {})?.bundlePath).toBe(older)
  })

  it("honours the env override", () => {
    const root = extDir()
    const bundle = install(root, "anthropic.claude-code-1.2.0")
    const loc = locate(CC, root, { VIBEPERKS_CC_TARGET: bundle })
    expect(loc).toEqual({ bundlePath: bundle, version: "override" })
  })

  it("returns null when the override path does not exist", () => {
    expect(locate(CC, extDir(), { VIBEPERKS_CC_TARGET: "/no/such/file.js" })).toBeNull()
  })
})

describe("isSupportedVersion (version gate)", () => {
  it("allows allow-listed versions and the override sentinel", () => {
    expect(isSupportedVersion(CC, "1.2.0")).toBe(true)
    expect(isSupportedVersion(CC, "override")).toBe(true)
  })

  it("rejects unknown versions", () => {
    expect(isSupportedVersion(CC, "9.9.9")).toBe(false)
  })
})

describe("ADAPTERS registry", () => {
  it("ships claude-code and codex targets with distinct cli values", () => {
    const ids = ADAPTERS.map((a) => a.id)
    expect(ids).toContain("claude-code")
    expect(ids).toContain("codex")
    expect(ADAPTERS.find((a) => a.id === "claude-code")?.cli).toBe("vscode-claude-code")
    expect(ADAPTERS.find((a) => a.id === "codex")?.cli).toBe("vscode-codex")
  })
})
