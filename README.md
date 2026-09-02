CONFIDENTIALITY: INTERNAL
STATUS: DRAFT - UNREVIEWED

# Winifred

A quiet game about drinking a little less: a privacy-first, installable PWA
that keeps every piece of personal data on the device it runs on.

Built to `winifred-spec.md` (spec v1.1). Requirement IDs from that document
are referenced in commit messages and in the code where behaviour is not
self-evident.

Vite + React, no runtime dependencies beyond React, one component.

## Deploying

Pushing to `main` builds the app and publishes it to GitHub Pages via
`.github/workflows/deploy.yml`. The live app is at:

```
https://winifred-project.github.io/app/
```

`vite.config.js` sets `base: "/app/"` to match that path. If the repository
is ever renamed, or a custom domain is attached, that value has to change
with it or nothing will load.

One-off repository setup: Settings > Pages > Build and deployment > Source
must be set to **GitHub Actions**.

### Releasing (UPD-1 to UPD-5)

There is no version number to bump. A build identifies itself by the commit
it was built from, injected as `__BUILD_ID__` and shown in Settings as
`Build 62afb1c` with the date it was published. On GitHub Actions that comes
from `GITHUB_SHA`; locally it comes from `git rev-parse`, with a trailing
`+` when the working tree is dirty, because a build with uncommitted changes
is not the commit it claims to be. Ask for that string when a bug report is
vague: it points at an exact tree.

Whether a new build exists is not decided by that label. The service worker
compares its own precache manifest, which changes whenever any asset does,
so pushing to `main` is the whole release process.

Because the shell is precached, a home-screen launch never touches the
server, and on iOS the app is resumed rather than reloaded. Nothing would
notice a new build on its own, so `src/updates.js` asks the service worker
to look: when the app returns to the foreground, when a connection comes
back, and hourly while it is open.

Applying is the app's decision, not the worker's. `registerType` is
`"prompt"` rather than `"autoUpdate"`, because a silent reload can land in
the middle of a craving encounter (P1). A waiting build is offered on the
home screen only, is dismissible, and applies itself at the next cold start
if the offer is ignored. Stored state is untouched either way (DAT-1).

To say something about a release, edit `RELEASE_NOTE` in `src/App.jsx`: put
one line in `text` and give `id` a new value. It shows once per id, and
never to someone who has not finished onboarding. Most releases have nothing
to say, so most of the time `text` stays empty and the app stays quiet.

### Before attaching a custom domain

Browser storage is tied to the origin, so moving from `github.io` to a
custom domain leaves the old data behind on the old origin, which then
redirects. Export your data first (Settings > Export my data), then import
it on the new address. Same rule for moving between devices or browsers.

## Notes and limitations

- **Installing.** On iOS the app installs from Safari only: Share > Add to
  Home Screen. The app says so once, on first run, and then never again.
  Android and desktop Chrome offer their own install prompt.
- **Offline.** The whole shell is precached, so every mechanic works with no
  network. See *Releasing* below for how a new build reaches an installed
  app.
- **Cloud AI tier** is not switched on. It needs a server-side key proxy
  (a small Cloudflare Worker) so that no API key ever ships to the browser;
  that is Phase 2. The consent flow and the tier chooser are already built.
- **Local-model tier** simulates its download and uses the templated engine
  as a stand-in; Phase 2 replaces it with WebLLM.
- **Storage** is localStorage, per-origin. Export regularly: iOS can evict
  the storage of sites you have not opened in a while, though an installed
  app is much less likely to be hit.
- **Not medical advice.** The app is a behavioural prototype and is not
  suitable for anyone experiencing physical alcohol withdrawal; that needs
  a GP.

## Local development

```bash
npm install && npm run dev     # Node 20+
```

or, with Docker:

```bash
docker compose up --build
```

Then open `http://<your-computer-ip>:5173` on a phone on the same wifi
(`ipconfig getifaddr en0` on macOS). The dev server hot-reloads. Note that
service workers and PWA install do not work over plain http, so test those
against the deployed HTTPS site.

## Project structure

```
.github/workflows/   build and publish to GitHub Pages on push to main
docker-compose.yml   dev service, port 5173, live-reload bind mount
Dockerfile           node:20-alpine + vite dev server on 0.0.0.0
vite.config.js       base path, dev server, PWA manifest and service worker
src/updates.js       service worker registration and release checking
public/              app icons, generated from the companion artwork
src/App.jsx          the entire app (single-component prototype)
src/main.jsx         React entry point
index.html           shell with mobile viewport, theme colour and iOS meta
```

---

## Document Provenance

### AI Generation Disclosure

| Field | Value |
|---|---|
| AI Involvement | Drafted |
| AI Model | Claude Fable 5 (claude-fable-5) |
| AI Platform | Claude.ai - Daemon Solutions workspace (Anthropic) |
| Human Accountable | [User to complete] |
| Date of Generation | 01 September 2026 |
| Document Status | DRAFT - UNREVIEWED |
| Human Oversight Record | Unreviewed |
| Personal Data Flag | No personal data. |
| Intended Audience | Daemon Solutions internal - personal project prototype |
| Known Limitations | Prototype quality: no automated tests, honour-system logging, localStorage persistence tied to the deployed origin, cloud AI tier stubbed pending a key proxy, simulated local-model download. Phase 1 packaging verified in headless Chromium at a 400px viewport (onboarding, AI wizard, offline reload under the service worker, CHT-6 and QST-3 safety paths); not yet verified on a physical iPhone. |
| Confidentiality Classification | INTERNAL |
| Version | v0.12 |

### Input Document Register

| Ref | Document Title | Document Type | Author / Source | Date | Classification | How Used |
|---|---|---|---|---|---|---|
| IDR-001 | Chat session: gamifying alcohol reduction, PWA concept, AI privacy tiers, Docker dev setup | Conversation | User and Claude | 01 September 2026 | Internal | Sole design brief; all mechanics and the trust-layer checkpoints agreed in conversation. |
| IDR-002 | winifred-prototype.jsx | Code File | Claude (this conversation) | 01 September 2026 | Internal | Source component, adapted for standalone build (localStorage swap, cloud tier stubbed). |
| IDR-003 | AI Training Data / General Knowledge | Internal Knowledge | Anthropic model training | Undated | Internal | Vite/Docker configuration patterns, behavioural design, React implementation. |
