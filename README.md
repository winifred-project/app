CONFIDENTIALITY: INTERNAL
STATUS: DRAFT - UNREVIEWED

# Winifred (dev build)

A gamified drink-reduction app prototype, packaged as a Vite + React project with a Docker Compose dev setup so it can be tested from a phone on the same wifi network.

## Run it

```bash
docker compose up --build
```

Then find your computer's LAN IP address:

- macOS: `ipconfig getifaddr en0`
- Linux: `hostname -I`
- Windows: `ipconfig` (look for the IPv4 address of your wifi adapter)

On your phone (same wifi network), open:

```
http://<your-computer-ip>:5173
```

The Vite dev server hot-reloads: edit `src/App.jsx` on your machine and the phone updates live.

Without Docker: `npm install && npm run dev` does the same thing (Node 20+).

## Notes and limitations

- **HTTP only.** No HTTPS in this dev setup, so service workers, real PWA install and some capability checks (e.g. WebGPU on some browsers) are restricted. iOS "Add to Home Screen" still creates a working shortcut. For a proper PWA test, deploy to an HTTPS host.
- **Firewall.** If the phone can't connect, your computer's firewall is probably blocking inbound port 5173.
- **Storage** is localStorage, per-browser and per-origin. Because the origin is your LAN IP, data won't carry over if your computer's IP changes; use the in-app "Export my data" as insurance.
- **Cloud AI tier** is intentionally disabled in this build: it requires a server-side key proxy (e.g. a small Cloudflare Worker) so no API key ever ships to the browser. The consent flow is present in the code, ready for when a proxy is wired in. The templated companion, capability detection, and all game mechanics are fully functional.
- **Local-model tier** simulates its download and uses the templated engine as a stand-in; a real build would integrate WebLLM or the browser's built-in model API.
- **Not medical advice.** The app is a behavioural prototype and is not suitable for anyone experiencing physical alcohol withdrawal; that needs a GP.

## Project structure

```
docker-compose.yml   dev service, port 5173, live-reload bind mount
Dockerfile           node:20-alpine + vite dev server on 0.0.0.0
vite.config.js       host:true so the LAN can reach the server
src/App.jsx          the entire app (single-component prototype)
src/main.jsx         React entry point
index.html           shell with mobile viewport + theme colour
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
| Known Limitations | Prototype quality: no automated tests, honour-system logging, localStorage persistence tied to the dev origin, cloud AI tier stubbed pending a key proxy, simulated local-model download. Production build verified to compile (vite build) but not manually tested on-device. |
| Confidentiality Classification | INTERNAL |
| Version | v0.11 |

### Input Document Register

| Ref | Document Title | Document Type | Author / Source | Date | Classification | How Used |
|---|---|---|---|---|---|---|
| IDR-001 | Chat session: gamifying alcohol reduction, PWA concept, AI privacy tiers, Docker dev setup | Conversation | User and Claude | 01 September 2026 | Internal | Sole design brief; all mechanics and the trust-layer checkpoints agreed in conversation. |
| IDR-002 | winifred-prototype.jsx | Code File | Claude (this conversation) | 01 September 2026 | Internal | Source component, adapted for standalone build (localStorage swap, cloud tier stubbed). |
| IDR-003 | AI Training Data / General Knowledge | Internal Knowledge | Anthropic model training | Undated | Internal | Vite/Docker configuration patterns, behavioural design, React implementation. |
