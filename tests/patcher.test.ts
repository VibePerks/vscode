import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  MARK_END,
  MARK_START,
  backupPath,
  isPatched,
  patch,
  restore,
  stripBlock,
} from "../src/patcher"

const dirs: string[] = []
const PRISTINE = "// host bundle\nconsole.log('claude')\n"

function bundle(content = PRISTINE): string {
  const dir = mkdtempSync(join(tmpdir(), "vibeperks-patch-"))
  dirs.push(dir)
  const p = join(dir, "index.js")
  writeFileSync(p, content, "utf8")
  return p
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe("patch", () => {
  it("injects a marker-wrapped block and captures a byte-exact backup", () => {
    const p = bundle()
    patch(p, "BLOCK_A")
    const out = readFileSync(p, "utf8")
    expect(out.startsWith(PRISTINE)).toBe(true)
    expect(isPatched(out)).toBe(true)
    expect(out).toContain(MARK_START)
    expect(out).toContain(MARK_END)
    expect(out).toContain("BLOCK_A")
    expect(readFileSync(backupPath(p), "utf8")).toBe(PRISTINE)
  })

  it("is idempotent: re-patching replaces the block, never stacks", () => {
    const p = bundle()
    patch(p, "BLOCK_A")
    patch(p, "BLOCK_B")
    const out = readFileSync(p, "utf8")
    expect(out).not.toContain("BLOCK_A")
    expect(out).toContain("BLOCK_B")
    expect(
      out.match(new RegExp(MARK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")),
    ).toHaveLength(1)
  })

  it("recaptures the backup when the host overwrote the bundle (no marker)", () => {
    const p = bundle()
    patch(p, "BLOCK_A")
    // simulate a host update: bundle replaced, our patch gone
    const updated = "// host bundle v2\nconsole.log('claude2')\n"
    writeFileSync(p, updated, "utf8")
    patch(p, "BLOCK_C")
    expect(readFileSync(backupPath(p), "utf8")).toBe(updated)
    expect(readFileSync(p, "utf8").startsWith(updated)).toBe(true)
  })
})

describe("restore", () => {
  it("reverts byte-for-byte from the backup and removes it", () => {
    const p = bundle()
    patch(p, "BLOCK_A")
    restore(p)
    expect(readFileSync(p, "utf8")).toBe(PRISTINE)
    expect(existsSync(backupPath(p))).toBe(false)
  })

  it("strips the block when no backup exists (fallback)", () => {
    const p = bundle()
    patch(p, "BLOCK_A")
    rmSync(backupPath(p))
    restore(p)
    expect(isPatched(readFileSync(p, "utf8"))).toBe(false)
  })

  it("is a no-op on an unpatched bundle", () => {
    const p = bundle()
    restore(p)
    expect(readFileSync(p, "utf8")).toBe(PRISTINE)
  })
})

describe("stripBlock", () => {
  it("leaves content without a marker untouched", () => {
    expect(stripBlock(PRISTINE)).toBe(PRISTINE)
  })

  it("removes exactly the wrapped block", () => {
    const wrapped = `${PRISTINE}\n${MARK_START}\nX\n${MARK_END}\n`
    expect(stripBlock(wrapped)).toBe(PRISTINE)
  })
})
