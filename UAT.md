# Sophia Client — UAT Checklist

End-to-end acceptance checklist for `sophia_client` (TrueSight Ops Console). Each item
states the **surface**, **what to do**, **what to expect**, and the **pass criterion**.

**Test tiers:** `[A]` = automated (vitest/Playwright) · `[S]` = self-UAT (machine) · `[H]` = human UAT (needs Gary's governor key).

---

## 1. Boot & config

| # | Tier | Action | Expect | Pass |
|---|---|---|---|---|
| 1.1 | [A] | `npm test` | 21 tests green (crypto, SSE, channels, attachments) | ✅ |
| 1.2 | [S] | `./serve.sh` → open `http://localhost:8000` | `index.html` 200, `config.json` 200 | ✅ |
| 1.3 | [S] | `node scripts/headless-uat.mjs` | 13/13 checks, zero console/page JS errors | ✅ |
| 1.4 | [S] | Open app | title + `deployment: local → https://sophia.truesight.me` in sidebar | ✅ |

## 2. Auth (RSA proof-of-possession)

| # | Tier | Action | Expect | Pass |
|---|---|---|---|---|
| 2.1 | [S] | `node scripts/self-uat.mjs` | fresh key → `/chat` and `/chat/upload` both **403** (not 401) → crypto matches the brain | ✅ |
| 2.2 | [S] | Open app with no key | "Connect identity" button shown; identity shows `(none)` | ✅ |
| 2.3 | [S] | Click Connect | existing key reused (no new key), identity shows `identity: <12-char fingerprint>` | ✅ |
| 2.4 | [H] | Connect as **Gary's governor key** | no 403; can send + receive | ⏳ |

## 3. Channel visibility (role model)

| # | Tier | Action | Expect | Pass |
|---|---|---|---|---|
| 3.1 | [S] | Before connect (guest) | only **public** channels visible (e.g. `# lobby`) | ✅ |
| 3.2 | [S] | After connect (governor) | all channels visible (private + public) | ✅ |
| 3.3 | [A] | `test/channels.test.ts` | guest/member see public only; governor/sentinel see all | ✅ |

## 4. Channel & category management (governor/sentinel)

| # | Tier | Action | Expect | Pass |
|---|---|---|---|---|
| 4.1 | [S] | Connect → `+ New channel` visible | button shows only for governor/sentinel | ✅ |
| 4.2 | [S] | Create `name=uat-test, category=UAT` | new channel appears under a new `UAT` category, becomes active | ✅ |
| 4.3 | [S] | Hover a channel → `✕` → click | channel removed (retired); built-in channels are hidden locally | ✅ |
| 4.4 | [S] | Retire the active channel | chat pane resets to "# select a channel" (no crash) | ✅ |

## 5. Chat (send / stream / history)

| # | Tier | Action | Expect | Pass |
|---|---|---|---|---|
| 5.1 | [H] | Send a message | your bubble appears, then Sophia's reply streams in and renders | ⏳ |
| 5.2 | [H] | During a tool-heavy turn | `🔧 <tool>` progress + `token` streaming, then final answer | ⏳ |
| 5.3 | [H] | Reload the page, reselect channel | history reloads from `GET /session` | ⏳ |
| 5.4 | [S] | Send with a non-governor key | graceful error bubble (no JS exception) | ✅ |
| 5.5 | [A] | `test/sse.test.ts` | `done`/`token`/`heartbeat` SSE parsed correctly | ✅ |

## 6. Attachments

| # | Tier | Action | Expect | Pass |
|---|---|---|---|---|
| 6.1 | [S] | Click `📎` → pick file(s) | button shows `📎 N`; no JS error | ✅ |
| 6.2 | [H] | Send a file + message | multipart `POST /chat/upload`; Sophia processes and replies | ⏳ |
| 6.3 | [H] | Receive a reply containing an image URL / `/uploads/…` | image renders inline in the bubble | ⏳ |
| 6.4 | [A] | `test/attachments.test.ts` | `detectAttachments` + `signMessage` shape verified | ✅ |

## 7. Reactions

| # | Tier | Action | Expect | Pass |
|---|---|---|---|---|
| 7.1 | [S] | Hover/click 👍 on a Sophia reply | reaction toggles active; persists across reload | ✅ (code path) |

## 8. PWA

| # | Tier | Action | Expect | Pass |
|---|---|---|---|---|
| 8.1 | [H] | Open app, "Add to Home Screen" | installs as standalone; icon + `manifest.json` valid | ⏳ |
| 8.2 | [S] | `service-worker.js` | caches same-origin GET shell only; never intercepts POST / cross-origin | ✅ (by design) |

## 9. Per-deployment config

| # | Tier | Action | Expect | Pass |
|---|---|---|---|---|
| 9.1 | [S] | Edit `config.json` → `sophiaBaseUrl` | client re-points to that instance on reload | ✅ |
| 9.2 | [S] | Edit categories/channels in `config.json` | new built-in channels appear | ✅ |

---

## Known gaps (require server work — not client)

- **G1 — tiered auth (PR4).** Browser endpoints (`/chat` signed, `/media-archive-pipeline/auth/challenge`)
  are **governor-only**; a **sentinel** key (e.g. DeepSeek Local) and **member** keys get 403. To honor
  "members read, sentinels execute", the brain needs a `POST /auth/tier` that resolves governor/sentinel/member/guest
  from the ledger and mints a correctly-tiered JWT. **Needs a `truesight_autopilot` code change + deploy (gated).**
- **G2 — sentinel resolution bug (pre-existing).** `governor_registry.sentinel_emails()` is email-keyed and
  omits sentinels whose cache row has `email:null` (tracked in `OPEN_FOLLOWUPS.md`). My DeepSeek key
  (`admin+deepseek@truesight.me`) still resolves to 403 even on the `allow_sentinel` path.
- **G3 — `GET /session` unauthenticated read (pre-existing).** History is keyed by `X-Public-Key` alone.

## What still needs a human (Gary)

1. **2.4 / 5.x / 6.2 — authenticated round-trip** with your governor key (send, stream, history, upload).
2. **8.1 — PWA install.**
3. **G1/G2 — the server-side tiered-auth + sentinel-resolution fix** (I can write the PR, but deploying the
   brain is an always-stop gate and would restart in-flight Sophia turns).
