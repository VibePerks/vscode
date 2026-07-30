import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"

// The injected block is wrapped in these exact markers so patch detection and
// restore are unambiguous and idempotent (we never double-inject or strip the
// host vendor's own code).
export const MARK_START = "/* VIBEPERKS-ADS-START */"
export const MARK_END = "/* VIBEPERKS-ADS-END */"

// backupPath is the byte-exact pristine copy captured before the first patch.
export function backupPath(bundlePath: string): string {
  return bundlePath + ".vibeperks.bak"
}

function tmpPath(bundlePath: string): string {
  return bundlePath + ".vibeperks.tmp"
}

// sha256 hashes text; used to detect when a host update has overwritten our patch.
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

// isPatched reports whether our marker block is present in the bundle content.
export function isPatched(content: string): boolean {
  return content.includes(MARK_START)
}

// stripBlock removes a marker-wrapped block (including the leading newline we add)
// if present, leaving the rest of the bundle untouched. Idempotent.
export function stripBlock(content: string): string {
  const start = content.indexOf(MARK_START)
  if (start === -1) return content
  const end = content.indexOf(MARK_END, start)
  if (end === -1) return content
  let cut = end + MARK_END.length
  if (content[cut] === "\n") cut += 1
  let from = start
  if (from > 0 && content[from - 1] === "\n") from -= 1
  return content.slice(0, from) + content.slice(cut)
}

// wrap builds the marker-delimited block appended to the bundle.
export function wrap(block: string): string {
  return `\n${MARK_START}\n${block}\n${MARK_END}\n`
}

function writeAtomic(path: string, data: string): void {
  const tmp = tmpPath(path)
  writeFileSync(tmp, data, "utf8")
  renameSync(tmp, path)
}

// patch injects (or re-injects) `block` into the webview bundle. On the first
// patch it captures a byte-exact backup of the pristine file. It is idempotent and
// safe to call for rotation: an existing block is restored from the backup first
// so the injected ad is replaced rather than stacked. If the host updated the
// bundle (no marker, content differs from backup) a fresh backup is recaptured.
export function patch(bundlePath: string, block: string): void {
  const bak = backupPath(bundlePath)
  let pristine = readFileSync(bundlePath, "utf8")
  if (isPatched(pristine)) {
    pristine = existsSync(bak) ? readFileSync(bak, "utf8") : stripBlock(pristine)
  } else {
    copyFileSync(bundlePath, bak) // (re)capture the current pristine file byte-exact
  }
  writeAtomic(bundlePath, pristine + wrap(block))
}

// restore reverts the bundle byte-for-byte from the backup and removes it. If no
// backup exists it strips our marker block as a best-effort fallback. Safe to call
// when the bundle was never patched (no-op).
export function restore(bundlePath: string): void {
  const bak = backupPath(bundlePath)
  if (existsSync(bak)) {
    const tmp = tmpPath(bundlePath)
    copyFileSync(bak, tmp)
    renameSync(tmp, bundlePath)
    rmSync(bak)
    return
  }
  const current = readFileSync(bundlePath, "utf8")
  if (isPatched(current)) writeAtomic(bundlePath, stripBlock(current))
}
