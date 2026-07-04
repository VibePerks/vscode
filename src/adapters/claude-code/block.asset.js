/*
 * VibePerks injected sponsor block - Claude Code VS Code webview.
 *
 * This file is a TEMPLATE. The VibePerks extension substitutes the
 * __VIBEPERKS_*__ placeholders with the served ad at patch time and injects the
 * result (marker-wrapped) into Anthropic's already-installed webview bundle. It
 * runs INSIDE the host webview, so it:
 *   - only rewrites the spinner verb text into one quiet sponsor line,
 *   - never reads code, prompts, file names, or chat content,
 *   - reports ad-only events (rendered / viewable / view / click) to the
 *     extension's localhost loopback, best-effort (CSP may block these; the click
 *     href is the reliable billing path because the webview host opens http(s)
 *     links externally),
 *   - wraps everything in its own try/catch so a render error can never throw
 *     inside the host webview.
 */
;(function () {
  "use strict"
  try {
    var SENTENCE = __VIBEPERKS_AD_SENTENCE__
    var DOMAIN = __VIBEPERKS_AD_DOMAIN__
    var CLICK_URL = __VIBEPERKS_CLICK_URL__
    var LOOPBACK_BASE = __VIBEPERKS_LOOPBACK_BASE__
    var TOKEN = __VIBEPERKS_TOKEN__
    var VIEW_THRESHOLD_MS = __VIBEPERKS_VIEW_THRESHOLD_MS__

    // Candidate selectors for Claude Code's in-panel "thinking" spinner verb. Kept
    // as an allow-list anchor map so a host update that moves the node fails closed
    // (no spinner found -> we render nothing) rather than corrupting the panel.
    var SPINNER_SELECTORS = [
      "[data-vibeperks-spinner]",
      "[data-testid='thinking-text']",
      "[data-testid='spinner-text']",
      ".thinking-indicator .label",
      ".spinner-verb",
    ]

    function eventUrl(event, ms) {
      var url = LOOPBACK_BASE + "/vibeperks-ads/" + encodeURIComponent(TOKEN) + "/" + event
      return ms ? url + "?ms=" + ms : url
    }

    function ping(event, ms) {
      try {
        if (typeof fetch === "function") {
          fetch(eventUrl(event, ms), { mode: "no-cors", keepalive: true }).catch(function () {})
        }
      } catch (e) {
        /* best-effort metrics only */
      }
    }

    function clickHref() {
      return (
        LOOPBACK_BASE +
        "/vibeperks-ads/" +
        encodeURIComponent(TOKEN) +
        "/click?to=" +
        encodeURIComponent(CLICK_URL)
      )
    }

    function adText() {
      return DOMAIN && SENTENCE.indexOf(DOMAIN) === -1 ? SENTENCE + " - " + DOMAIN : SENTENCE
    }

    function buildLine() {
      var a = document.createElement("a")
      a.setAttribute("data-vibeperks-ad", "1")
      a.href = clickHref()
      a.title = "Sponsored - VibePerks"
      a.style.opacity = "0.8"
      // The whole line is a clickable link; the sentence is shown in bold and the
      // advertiser's domain is underlined so the link reads as a link.
      a.style.textDecoration = "none"
      var line = adText()
      var idx = DOMAIN ? line.lastIndexOf(DOMAIN) : -1
      if (idx >= 0) {
        var pre = line.slice(0, idx)
        if (pre) {
          var sentenceEl = document.createElement("span")
          sentenceEl.style.fontWeight = "bold"
          sentenceEl.textContent = pre
          a.appendChild(sentenceEl)
        }
        var domainEl = document.createElement("span")
        domainEl.style.textDecoration = "underline"
        domainEl.textContent = line.slice(idx)
        a.appendChild(domainEl)
      } else {
        var boldEl = document.createElement("span")
        boldEl.style.fontWeight = "bold"
        boldEl.textContent = line
        a.appendChild(boldEl)
      }
      a.addEventListener("click", function () {
        ping("click", 0)
      })
      return a
    }

    function findSpinner() {
      for (var i = 0; i < SPINNER_SELECTORS.length; i++) {
        var el = document.querySelector(SPINNER_SELECTORS[i])
        if (el) return el
      }
      return null
    }

    function render() {
      var spinner = findSpinner()
      if (!spinner) return false
      if (spinner.querySelector("[data-vibeperks-ad]")) return true
      spinner.textContent = ""
      spinner.appendChild(buildLine())
      ping("impression_rendered", 0)
      return true
    }

    // Viewability: accrue visible time and credit once past the threshold.
    var visibleMs = 0
    var credited = false
    var last = Date.now()
    function tick() {
      try {
        var now = Date.now()
        var present = !!document.querySelector("[data-vibeperks-ad]")
        var visible = document.visibilityState !== "hidden"
        if (present && visible) {
          visibleMs += now - last
          ping("view_tick", visibleMs)
          if (!credited && visibleMs >= VIEW_THRESHOLD_MS) {
            credited = true
            ping("view_threshold_met", visibleMs)
          }
        }
        last = now
      } catch (e) {
        /* fail silent */
      }
    }

    if (render()) {
      ping("impression_viewable", 0)
    } else if (document.body && typeof MutationObserver === "function") {
      // Spinner not mounted yet; watch for it to appear, then render once.
      var obs = new MutationObserver(function () {
        if (render()) {
          ping("impression_viewable", 0)
          obs.disconnect()
        }
      })
      obs.observe(document.body, { childList: true, subtree: true })
    }

    if (typeof setInterval === "function") {
      setInterval(tick, 1000)
    }
  } catch (e) {
    /* fail silent inside the host webview */
  }
})()
