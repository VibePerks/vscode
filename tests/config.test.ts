import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_API_BASE, loadConfig, type ConfigEnv } from "../src/config"

const dirs: string[] = []

function tempHome(config?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "vibeperks-vscode-"))
  dirs.push(dir)
  if (config !== undefined) {
    writeFileSync(join(dir, "config.json"), JSON.stringify(config), "utf8")
  }
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe("loadConfig", () => {
  it("returns defaults when the config file is absent", () => {
    const env: ConfigEnv = { VIBEPERKS_HOME: tempHome() }
    expect(loadConfig(env)).toEqual({ apiBase: DEFAULT_API_BASE, deviceToken: "", optOut: false })
  })

  it("reads the shared config file", () => {
    const env: ConfigEnv = {
      VIBEPERKS_HOME: tempHome({
        api_base: "https://api.test/",
        device_token: "tok",
        opt_out: true,
      }),
    }
    expect(loadConfig(env)).toEqual({
      apiBase: "https://api.test",
      deviceToken: "tok",
      optOut: true,
    })
  })

  it("lets env overrides win over the file", () => {
    const env: ConfigEnv = {
      VIBEPERKS_HOME: tempHome({ api_base: "https://file", device_token: "filetok" }),
      VIBEPERKS_API: "https://env/",
      VIBEPERKS_DEVICE_TOKEN: "envtok",
    }
    const cfg = loadConfig(env)
    expect(cfg.apiBase).toBe("https://env")
    expect(cfg.deviceToken).toBe("envtok")
  })

  it("propagates malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "vibeperks-vscode-"))
    dirs.push(dir)
    writeFileSync(join(dir, "config.json"), "{ not json", "utf8")
    expect(() => loadConfig({ VIBEPERKS_HOME: dir })).toThrow()
  })
})
