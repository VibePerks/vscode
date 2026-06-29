# VibePerks for VS Code (Claude Code & Codex panels)

A VS Code extension that renders **one quiet sponsor line inside the Claude Code
and Codex panel spinners** while the agent is thinking - and **nothing about your
code, prompts, or files ever leaves your machine.**

```
Fast APIs for every chain - alchemy.com
```

This reaches a surface none of the other VibePerks adapters touch: the **in-panel
webview spinner** of the Claude Code and Codex VS Code extensions. It uses the
**same backend contract** as every adapter (`GET /v1/ads/serve` ->
`POST /v1/impressions`) and the **same** shared `~/.vibeperks/config.json`, so one
login configures everything.

## How it works

The Claude Code and Codex panels are VS Code **webviews** that this extension does
not own, so - like Kickbacks - it patches the vendor's already-installed webview
bundle on disk:

1. **Locate + version-gate.** On `onStartupFinished` it finds the newest installed
   `anthropic.claude-code-*` / `openai.chatgpt-*` extension and its webview bundle.
   It only injects into bundle versions on a verified **allow-list**; an unknown
   release is left **completely untouched** (the status bar shows `(!)`).
2. **Backup + inject.** It captures a **byte-exact backup** of the pristine bundle,
   then appends a `/* VIBEPERKS-ADS-START */` block (the served ad, control-stripped
   and JSON-escaped). The block runs inside the host webview and replaces the
   spinner verb with one quiet, clickable sponsor line. Injection is **idempotent**
   and atomic.
3. **Report.** The webview CSP (`default-src 'none'`) blocks in-page network calls,
   so the **click** is a real `http(s)` href that the webview host opens externally
   against a **localhost loopback** server; the loopback records the click and
   redirects to the advertiser. Best-effort view metrics also ping the loopback.
   The **extension host** (never the webview) holds the device token and calls
   `POST /v1/impressions` once a view crosses the dwell threshold.
4. **Rotate + self-heal.** A rotation timer re-patches with a fresh ad each
   `rotate_seconds`. If a host update overwrites the patch, the backup is recaptured
   and the bundle re-patched.
5. **Restore.** `VibePerks: Restore Claude Code` / `Restore Codex` / `Restore all`
   revert the bundle **byte-for-byte**; `deactivate()` restores on shutdown too.

All network, auth, caching, and the contract live in the small TypeScript modules
in [`src/`](src) (`client.ts`, `config.ts`, `engine.ts`, `store.ts`, `patcher.ts`,
`loopback.ts`). The entry [`src/extension.ts`](src/extension.ts) is the **single
fail-silent boundary**: every command and async task runs inside one `try/catch`,
so a VibePerks error can never break or slow VS Code. The injected
`block.asset.js` has its own top-level `try/catch` because it runs inside the host
webview.

## What leaves your machine

| Leaves your machine | Never leaves your machine |
|---|---|
| Device token (to authenticate) | Your code or file contents |
| Display facts: how long an ad was shown, CLI + plugin version | Your prompts or the agent's replies |
| Ad-only events: rendered / viewable / view / click | File names, paths, or repo names |

The injected block only rewrites the spinner verb text and reports ad-only events.
It never reads code, prompts, completions, or chat content.

## Configuration

The extension reads the **same** local config as every other VibePerks adapter:

- Config file: `~/.vibeperks/config.json` (override the directory with
  `$VIBEPERKS_HOME`), shape `{ "api_base", "device_token", "opt_out" }`.
- Env overrides: `$VIBEPERKS_DEVICE_TOKEN`, `$VIBEPERKS_API`.
- Opt out with `"opt_out": true` - the extension then patches nothing, reports
  nothing, and reverts any prior patch.

With no device token configured, nothing is injected and zero network calls are
made.

## Surfaces

| Surface | `cli` reported | Patched bundle |
|---|---|---|
| Claude Code panel spinner | `vscode-claude-code` | `anthropic.claude-code-*/webview/index.js` |
| Codex panel spinner | `vscode-codex` | `openai.chatgpt-*/webview/index.js` |

## Install

Sideload the packaged extension:

```sh
curl -L https://vibeperks.ai/vsix -o vibeperks.vsix && code --install-extension vibeperks.vsix
```

(`/vsix` redirects to the current package; a Marketplace / Open VSX listing may
also be available.)

## Develop

```sh
npm install
npm run format:check   # prettier
npm run typecheck      # tsc --noEmit
npm test               # vitest (logic + jsdom block + loopback)
npm run build          # esbuild bundle -> dist/extension.js
npm run package        # vsce package -> vibeperks.vsix
```

## Operator notes

This surface patches another publisher's installed extension files. That carries
ToS / Marketplace policy risk and an ongoing version-compatibility burden (each
Claude Code / Codex release can move the spinner anchor and wipe the patch). The
version allow-list in [`src/adapters/registry.ts`](src/adapters/registry.ts) is
intentionally empty until a build is hand-verified, so the extension is **inert by
default** until an operator adds a known-good version.

## License

PolyForm Shield 1.0.0 - see [LICENSE](LICENSE).
