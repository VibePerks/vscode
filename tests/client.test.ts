import { describe, expect, it } from "vitest"
import { VibePerksClient, type FetchFn } from "../src/client"
import { RejectedError, UnauthorizedError } from "../src/errors"
import type { Ad, Impression } from "../src/types"
import { isEarningCapped } from "../src/types"

interface Call {
  url: string
  init: RequestInit | undefined
}

function recordingFetch(status: number, body: unknown): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = []
  const fetch: FetchFn = async (input, init) => {
    calls.push({ url: String(input), init })
    if (status === 204) return new Response(null, { status })
    return new Response(JSON.stringify(body), { status })
  }
  return { fetch, calls }
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>
  return headers[name]
}

const sampleAd: Ad = {
  ad_id: "a1",
  sentence: "Get paid while vibe\u001b coding - VibePerks.ai",
  domain: "VibePerks.ai\u0000",
  impression_token: "imp1",
  rotate_seconds: 30,
}

describe("VibePerksClient.serve", () => {
  it("returns a sanitized ad on 200 and attaches the device token", async () => {
    const { fetch, calls } = recordingFetch(200, sampleAd)
    const client = new VibePerksClient("https://api.example.com/", "dev-token", fetch)
    const result = await client.serve()
    expect(isEarningCapped(result)).toBe(false)
    const ad = result as Ad
    expect(ad.sentence).toBe("Get paid while vibe coding - VibePerks.ai")
    expect(ad.domain).toBe("VibePerks.ai")
    expect(calls[0].url).toBe("https://api.example.com/v1/ads/serve")
    expect(header(calls[0].init, "X-Device-Token")).toBe("dev-token")
    expect(calls[0].init?.method).toBe("GET")
  })

  it("returns an earning-capped signal on 200 with status earning_capped", async () => {
    const { fetch } = recordingFetch(200, {
      status: "earning_capped",
      ad_id: null,
      try_again_at: "2026-07-21T15:00:00+00:00",
    })
    const result = await new VibePerksClient("https://x", "t", fetch).serve()
    expect(isEarningCapped(result)).toBe(true)
    if (isEarningCapped(result)) expect(result.try_again_at).toBe("2026-07-21T15:00:00+00:00")
  })

  it("returns null on 204 (empty inventory)", async () => {
    const { fetch } = recordingFetch(204, null)
    expect(await new VibePerksClient("https://api.example.com", "t", fetch).serve()).toBeNull()
  })

  it("throws UnauthorizedError on 401 and 403", async () => {
    for (const status of [401, 403]) {
      const { fetch } = recordingFetch(status, {})
      await expect(new VibePerksClient("https://x", "t", fetch).serve()).rejects.toBeInstanceOf(
        UnauthorizedError,
      )
    }
  })

  it("propagates an error on an unexpected status", async () => {
    const { fetch } = recordingFetch(500, {})
    await expect(new VibePerksClient("https://x", "t", fetch).serve()).rejects.toThrow(
      /unexpected status 500/,
    )
  })
})

describe("VibePerksClient.postImpression", () => {
  const imp: Impression = {
    impression_token: "imp1",
    displayed_ms: 1200,
    session_id: "s1",
    cli: "vscode-claude-code",
    cli_version: "1.0.0",
    plugin_version: "0.1.0",
  }

  it("succeeds on 200 and 201 and sends the contract payload + token", async () => {
    for (const status of [200, 201]) {
      const { fetch, calls } = recordingFetch(status, {})
      await new VibePerksClient("https://x", "tok", fetch).postImpression(imp)
      expect(calls[0].url).toBe("https://x/v1/impressions")
      expect(header(calls[0].init, "X-Device-Token")).toBe("tok")
      expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
        impression_token: "imp1",
        cli: "vscode-claude-code",
      })
    }
  })

  it("throws UnauthorizedError on 401/403", async () => {
    const { fetch } = recordingFetch(403, {})
    await expect(
      new VibePerksClient("https://x", "t", fetch).postImpression(imp),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it("throws RejectedError on a non-auth 4xx", async () => {
    const { fetch } = recordingFetch(422, {})
    await expect(
      new VibePerksClient("https://x", "t", fetch).postImpression(imp),
    ).rejects.toBeInstanceOf(RejectedError)
  })

  it("propagates 5xx so the caller can retry", async () => {
    const { fetch } = recordingFetch(503, {})
    await expect(new VibePerksClient("https://x", "t", fetch).postImpression(imp)).rejects.toThrow(
      /unexpected status 503/,
    )
  })
})
