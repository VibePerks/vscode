import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  DEFAULT_API_BASE,
  clearDeviceToken,
  loadConfig,
  saveDeviceToken,
  writeConfigPatch,
  type ConfigEnv,
} from "../src/config"

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

describe("writeConfigPatch / saveDeviceToken / clearDeviceToken", () => {
  it("creates the config file and persists a signed-in token", () => {
    const env: ConfigEnv = { VIBEPERKS_HOME: tempHome() }
    saveDeviceToken(env, "tok-123")
    expect(loadConfig(env)).toEqual({
      apiBase: DEFAULT_API_BASE,
      deviceToken: "tok-123",
      optOut: false,
    })
  })

  it("merges into existing config, preserving other adapters' fields", () => {
    const env: ConfigEnv = {
      VIBEPERKS_HOME: tempHome({ api_base: "https://api.test", opt_out: true }),
    }
    saveDeviceToken(env, "tok-abc")
    const raw = JSON.parse(readFileSync(join(env.VIBEPERKS_HOME!, "config.json"), "utf8"))
    expect(raw).toEqual({ api_base: "https://api.test", opt_out: true, device_token: "tok-abc" })
  })

  it("clears the token on sign out but keeps other fields", () => {
    const env: ConfigEnv = {
      VIBEPERKS_HOME: tempHome({ api_base: "https://api.test", device_token: "tok" }),
    }
    clearDeviceToken(env)
    const cfg = loadConfig(env)
    expect(cfg.deviceToken).toBe("")
    expect(cfg.apiBase).toBe("https://api.test")
  })

  it("writes the config file with 0600 permissions", function () {
    if (process.platform === "win32") return // POSIX mode bits are not meaningful on Windows
    const env: ConfigEnv = { VIBEPERKS_HOME: tempHome() }
    writeConfigPatch(env, { device_token: "tok" })
    const mode = statSync(join(env.VIBEPERKS_HOME!, "config.json")).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
