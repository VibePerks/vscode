import type { Ad } from "./types"

// Server ad copy is untrusted at the render boundary: every C0 control byte (incl.
// ESC, tab, newline) and DEL is stripped so it can never emit escape sequences or
// break the VS Code status bar / tooltip when rendered.
const CONTROL = /[\u0000-\u001f\u007f]/g

// sanitize strips control bytes and trims whitespace from untrusted server copy
// before it is ever cached or rendered.
export function sanitize(s: string): string {
  return s.replace(CONTROL, "").trim()
}

// renderLine formats an ad as a single plain-text line. The sentence already ends
// with the domain per the product spec; if it does not, the domain is appended
// defensively.
export function renderLine(ad: Ad): string {
  const sentence = sanitize(ad.sentence)
  const domain = sanitize(ad.domain)
  if (domain && !sentence.includes(domain)) {
    return `${sentence} - ${domain}`.trim()
  }
  return sentence
}
