import { describe, expect, it } from "vitest"
import { renderLine, sanitize } from "../src/sanitize"
import type { Ad } from "../src/types"

function ad(over: Partial<Ad> = {}): Ad {
  return {
    ad_id: "a1",
    sentence: "Get paid while vibe coding - VibePerks.ai",
    domain: "VibePerks.ai",
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
    expect(renderLine(ad())).toBe("Get paid while vibe coding - VibePerks.ai")
  })

  it("appends the domain defensively when missing", () => {
    expect(renderLine(ad({ sentence: "Get paid while vibe coding", domain: "VibePerks.ai" }))).toBe(
      "VibePerks.ai - Get paid while vibe coding",
    )
  })

  it("sanitizes both fields before composing", () => {
    expect(
      renderLine(
        ad({ sentence: "Get paid while\u001b vibe coding", domain: "VibePerks.ai\u0000" }),
      ),
    ).toBe("VibePerks.ai - Get paid while vibe coding")
  })
})
