import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { AddressInfo } from "node:net"

// LoopbackEvent is one ad-only signal the injected webview block reports back to
// the extension host. NOTHING about code, prompts, or files is ever carried.
export type LoopbackEvent =
  | "impression_rendered"
  | "impression_viewable"
  | "view_tick"
  | "view_threshold_met"
  | "click"

const METRIC_EVENTS: ReadonlySet<string> = new Set<LoopbackEvent>([
  "impression_rendered",
  "impression_viewable",
  "view_tick",
  "view_threshold_met",
])

export interface LoopbackDeps {
  // onEvent is invoked for every valid ping. `displayedMs` is the cumulative
  // visible time the block reported (0 for non-timed events).
  onEvent(token: string, event: LoopbackEvent, displayedMs: number): void
  // isAllowedRedirect gates the click redirect target (open-redirect/SSRF guard):
  // only http(s) URLs the host vouches for (the served ad's domain) are followed.
  isAllowedRedirect(url: string): boolean
}

export interface RunningLoopback {
  port: number
  base: string
  close(): Promise<void>
}

function parseMs(value: string | null): number {
  if (!value) return 0
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

// handle routes a single loopback request. Path shape:
//   /vibeperks-ads/<token>/<event>            -> 204 (metric ping)
//   /vibeperks-ads/<token>/click?to=<httpUrl> -> 302 redirect (billable click)
// Anything else -> 404. All inputs are validated here (the one boundary).
export function handle(req: IncomingMessage, res: ServerResponse, deps: LoopbackDeps): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  const parts = url.pathname.split("/").filter((p) => p.length > 0)
  if (parts.length !== 3 || parts[0] !== "vibeperks-ads") {
    res.writeHead(404).end()
    return
  }
  const token = decodeURIComponent(parts[1])
  const event = parts[2]
  if (!token) {
    res.writeHead(404).end()
    return
  }

  if (event === "click") {
    const to = url.searchParams.get("to") ?? ""
    if (!isHttpUrl(to) || !deps.isAllowedRedirect(to)) {
      res.writeHead(400).end()
      return
    }
    deps.onEvent(token, "click", 0)
    res.writeHead(302, { Location: to }).end()
    return
  }

  if (METRIC_EVENTS.has(event)) {
    deps.onEvent(token, event as LoopbackEvent, parseMs(url.searchParams.get("ms")))
    res.writeHead(204).end()
    return
  }

  res.writeHead(404).end()
}

// start launches the loopback HTTP server bound to localhost only. The injected
// block reaches it for best-effort metrics; the webview host opens the click href
// against it externally for reliable click billing.
export function start(deps: LoopbackDeps, host = "127.0.0.1"): Promise<RunningLoopback> {
  const server: Server = createServer((req, res) => {
    try {
      handle(req, res, deps)
    } catch {
      try {
        res.writeHead(500).end()
      } catch {
        /* response already gone */
      }
    }
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, host, () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        port,
        base: `http://${host}:${port}`,
        close: () => new Promise<void>((res2, rej2) => server.close((e) => (e ? rej2(e) : res2()))),
      })
    })
  })
}
