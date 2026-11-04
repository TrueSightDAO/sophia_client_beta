# Sophia Client — Implementation Plan & Execution Roadmap

First-party web client (PWA-capable) that talks directly to a Sophia instance (the
`truesight_autopilot` brain). One deployable client, configurable per deployment to point
at any current or future Sophia instance (including self-hosted / China-firewall-friendly
instances).

**Repo:** `~/Applications/sophia_client` (local git; NOT pushed to GitHub yet — behind the
Great Firewall. Push later when a path is available.)

**Scope lock (decisions made with Gary):**
- **Web app, not native.** Reuses the DAO RSA-keypair identity (`publicKey`/`privateKey` in
  `localStorage`), the brain's HTTPS + SSE endpoints, and the workspace's static-site
  beta/prod fork + promote + UAT conventions. PWA (`manifest.json` + `service-worker.js`)
  for the "feels like Discord/Telegram" shell.
- **Auth = RSA proof-of-possession** (oracle/capoeira pattern). No OAuth, no password.
  Keypair (WebCrypto SPKI/PKCS#8, byte-identical to `dapp/scripts/edgar_payload_helper.js`)
  → sign challenge → JWT → `Authorization: Bearer`.
- **Role tiers map 1:1 to the brain's `app/policy.py`:** `guest < member < governor`, plus
  `sentinel` (governor-equivalent). Enforced server-side at the tool layer, never in the UI.
  - Non-member (`guest`) → **view**
  - Member → **read / interact** (data-only, no write authority)
  - Governor / Sentinel → **read, write, execute**
- **Channel authority/visibility** (Gary's approval): public channels viewable by guest;
  private channels require governor/sentinel; channel creation is governor-only. The client
  model is config-driven (categories + channels), `X-Session-Id = client:<channel-id>`.

---

## Pre-flight checklist (access / prerequisites / decisions confirmed)

- [x] Brain API surface read from `sophia.truesight.me` (`app/main.py`, `app/auth.py`):
  - `POST /chat` — SSE. **Signed path (v1):** `X-Public-Key` + `{payload, signature}` where
    `payload = {message, timestamp, nonce, do_not_publish}`; `verify_payload` gates on
    **governor** (403 otherwise). JWT path (`Authorization: Bearer`) also exists.
  - `GET /session` — `X-Public-Key` + `X-Session-Id` → history (public-key keyed, no signature).
  - `GET /chat/progress`, `GET /chat/context`, `GET /chat/queue`; `POST /chat/upload` (multipart).
  - CORS: `cors_origins=["*"]` → a `localhost` origin works for the signed path (no cookies).
  - **Finding — nginx shadowing:** `location /auth/` → port 8002 (vault worker), so
    `sophia.truesight.me/auth/challenge` is NOT the brain's `/auth/challenge` (returns 404).
    **v1 therefore uses the signed-payload path on `/chat`, not `/auth/challenge`.**
  - **Finding — unauth history read:** `GET /session` authenticates by `X-Public-Key` alone
    (no signature/JWT), so session history is readable by anyone who knows a public key +
    session id. Pre-existing server behaviour; flagged for a follow-up (PR4/`POST /auth/tier`).
- [x] Crypto reference confirmed byte-identical to `dapp/scripts/edgar_payload_helper.js`:
  WebCrypto `RSASSA-PKCS1-v1_5` / SHA-256, public key = SPKI base64, private key = PKCS#8
  base64, `localStorage` keys `publicKey` / `privateKey` (shared identity across dapp/capoeira/oracle).
- [x] Server canonicalization confirmed: `verify_payload` signs
  `json.dumps(payload, separators=(",", ":"), ensure_ascii=False)` → client must sign
  `JSON.stringify(payload)` (compact, insertion-order keys, ASCII-only). No `sort_keys` on the server.
- [x] `verify_payload` requires `timestamp` (ISO-8601, within skew) and `nonce` (unique, replay-protected).
- [x] Deploy model: static site (no build step), served locally by `serve.sh`; per-deployment
  config in `config.json` (`sophiaBaseUrl`, `deployment`, categories/channels).
- [x] Firewall constraint: **zero CDN/network build dependencies** — crypto via native WebCrypto,
  no `unpkg` DaoClient import; `DaoClient` is NOT vendored (reimplemented in `js/crypto.js`).
- [x] **Known gap (server-side, later PR):** no endpoint mints a `member`/`guest` chat JWT from an
  arbitrary bound key. Until `POST /auth/tier` ships, "anyone can authenticate" is aspirational —
  v1 authenticates governor/sentinel keys only. Recorded in PR4 below. (Related: the v1 signed
  `/chat` path is governor-only; sentinels need an `allow_sentinel` challenge variant.)

> ✅ Pre-flight Completeness: no execution unit requires reading a file/state not already captured
> in the pre-flight.

---

## Sequenced plan (one PR per execution turn)

| Unit | What | Repo / surface | Advance | Status |
|------|------|----------------|---------|--------|
| **PR0** | Scaffold repo + `config.json` + `PLAN.md` + `serve.sh` + test harness | `sophia_client` | auto | ☑ done |
| **PR1** | Auth (WebCrypto keygen/reuse + `/auth/challenge` → JWT) + channel shell + SSE text chat + history | `sophia_client` | auto | ☐ |
| **PR2** | Attachments: send (`/chat/upload` multipart) + receive (render files in message stream) | `sophia_client` | auto | ☐ |
| **PR3** | Reactions / go-signal (👍 → dispatch) + thread rendering | `sophia_client` | auto | ☐ |
| **PR4** | Tiered auth (`guest`/`member` display + visibility) — **requires server `POST /auth/tier`** | `truesight_autopilot` + `sophia_client` | `gate: server change` | ☐ |
| **PR5** | PWA (manifest + service-worker + install) + beta/prod fork + promote | `sophia_client` | `gate: UAT` | ☐ |

Each PR: build → `npm test` (vitest + happy-dom) → self-UAT against live brain where the leg
does not require Gary's governor key → report.

## Resume tracker

```
RESUME HERE → PR1 (auth + channel shell + SSE chat)
PR0  scaffold+config+plan ......... ☑ done
PR1  auth + shell + chat .......... ☐ in progress   <-- RESUME HERE
PR2  attachments ................... ☐
PR3  reactions / go-signal ........ ☐
PR4  tiered auth (server) ......... ☐ gate: server endpoint
PR5  PWA + fork/promote ........... ☐ gate: UAT
```

## UAT phase (human, on live surfaces)

**R1 (self) — already performed by the builder before handing off:**
- [ ] `npm test` green (crypto round-trip, canonical JSON, SSE parse, channel visibility).
- [ ] Crypto-vs-server proof: a fresh (non-governor) key POSTing a signed message to `/chat`
  returns **403 (Access restricted to authorized governors)**, not **401 (Invalid signature)** —
  proves the signature is verified, not rejected. (No governor key needed for this check.)
  **PASSED 2026-10-28 via `scripts/self-uat.mjs`.**
- [ ] Local static serve (`./serve.sh`) loads `index.html`, renders the channel list from
  `config.json`, and surfaces the auth banner.

**R3 (human, Gary) — the only steps that require your governor key:**
1. Open `http://localhost:8000` (after `./serve.sh`).
2. Confirm the app reuses your existing identity — you should NOT be asked to make a new key;
   the "linked identity" should show your existing public key fingerprint.
3. Pick a channel → the client signs the challenge and authenticates (no error).
4. Send a test message → watch Sophia's reply stream in (SSE), then reload and confirm history
   persists via `GET /session`.
5. Pass = you can converse with Sophia turn-by-turn in the client. Then we proceed to PR2/PR3.

Prod/network changes, the `POST /auth/tier` server endpoint, and PWA fork/promote are
**always-stop** gates — never self-executed.

---

## Checklist (operator copy)

- [ ] `config.json` points at the intended Sophia (`sophiaBaseUrl`) for this deployment.
- [ ] `./serve.sh` (or `npx serve`) runs; no CDN fetch in the network tab.
- [ ] Identity reused (existing `publicKey` fingerprint shown, no new key generated).
- [ ] Auth challenge succeeds for a governor key.
- [ ] Text round-trip: message → SSE reply renders → history reloads.
- [ ] `npm test` green.
- [ ] (PR2) attachment upload renders; received attachment renders.
- [ ] (PR3) 👍 reaction dispatches a turn.
- [ ] (PR4) guest sees only public channels; member read-only; governor/sentinel full.
