/*
 * VibePerks injected sponsor block - Codex VS Code webview.
 *
 * Template; see the claude-code block.asset.js header for the full contract. This
 * variant only differs in the spinner anchor map (Codex's webview DOM differs from
 * Claude Code's). Everything else - privacy posture, best-effort loopback metrics,
 * reliable click href, own try/catch - is identical.
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

    // Codex spinner anchor map (allow-list; fails closed on an unknown layout).
    var SPINNER_SELECTORS = [
      "[data-vibeperks-spinner]",
      "[data-testid='codex-thinking']",
      ".codex-status .label",
      ".turn-status-text",
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
