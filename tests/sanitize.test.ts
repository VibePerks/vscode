import { describe, expect, it } from "vitest"
import { renderLine, sanitize } from "../src/sanitize"
import type { Ad } from "../src/types"

function ad(over: Partial<Ad> = {}): Ad {
  return {
    ad_id: "a1",
    sentence: "Fast APIs - alchemy.com",
    domain: "alchemy.com",
    impression_token: "imp1",
    rotate_seconds: 20,
    ...over,
  }
}

describe("sanitize", () => {
  it("strips C0 control bytes and DEL and trims", () => {
    expect(sanitize("  a\u0000b\u001bc\u007f  ")).toBe("abc")
  })

  it("removes newlines and tabs that could break the injected line", () => {
    expect(sanitize("line1\nline2\tend")).toBe("line1line2end")
  })
})

describe("renderLine", () => {
  it("returns the sentence unchanged when it already ends with the domain", () => {
    expect(renderLine(ad())).toBe("Fast APIs - alchemy.com")
  })

  it("appends the domain defensively when missing", () => {
    expect(renderLine(ad({ sentence: "Fast APIs", domain: "alchemy.com" }))).toBe(
      "Fast APIs - alchemy.com",
    )
  })

  it("sanitizes both fields before composing", () => {
    expect(renderLine(ad({ sentence: "Fast\u001b APIs", domain: "alchemy.com\u0000" }))).toBe(
      "Fast APIs - alchemy.com",
    )
  })
})
