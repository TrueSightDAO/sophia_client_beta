# Channel/Category Sync — Implementation Plan & Execution Roadmap

Move user-created **channels** and **categories** from per-browser `localStorage` to a
**server-side registry on Sophia (Redis)**, so the same set appears on every origin/device
(`localhost:8000`, `chat.truesight.me`, beta, future clients). Built-in channels stay in each
deployment's `config.json`; only the user-created overlay + retired ids move server-side.

**Status:** 🟡 planning (PR0) — implementation not started.

---

## Pre-flight checklist (access / decisions / prerequisites confirmed)

- [x] Redis is already on the box at `127.0.0.1:6379/0`; the brain reaches it via
  `app.redis_claim.get_client()` (`SOPHIA_REDIS_URL` env, password in vault
  `PHASE_C_REDIS_PASSWORD`). No new infra.
- [x] Brain auth primitives exist: `verify_jwt_claims(request)` + `author_role_from_claims()`
  (write gate = `governor`/`sentinel`, matching the existing channel-authority model).
- [x] CORS on the brain is `cors_origins=["*"]`, so the static client can call `/channels`
  cross-origin with `Authorization: Bearer <jwt>` (same as `/chat`).
- [x] Client already holds a JWT (`SophiaAuth.getToken()`) and resolves its own role.
- [x] Current client store: `channels.js` `localStorage` keys `sophia_channels_created`,
  `sophia_categories_created`, `sophia_channels_retired` (per-origin → the drift we're fixing).
- [x] Decision (Gary 2026-11-04): **Redis** as the backing store (not a JSON file, not GitHub).

> ✅ Pre-flight Completeness: no execution unit requires reading a file/state not already captured
> in the pre-flight.

## Sequenced plan (one PR per execution turn)

| Unit | What | Repo / surface | Advance | Status |
|------|------|----------------|---------|--------|
| **PR0** | This roadmap (checked in) | `sophia_client` | auto | ☑ |
| **PR1** | Brain: `app/channel_registry.py` (Redis CRUD) + `GET/POST/PUT/DELETE /channels` + `POST/DELETE /categories` endpoints; deploy | `truesight_autopilot` | auto | ☐ |
| **PR2** | Client `channels.js`: server-backed registry (async load + CRUD), `localStorage` kept only as a read fallback | `sophia_client` | auto | ☐ |
| **PR3** | Client `app.js`: load registry on connect; wire create/rename/visibility/retire + category create/delete to the server | `sophia_client` | auto | ☐ |
| **PR4** | Sync verification + UAT (see below); promote beta→prod | `sophia_client` | `gate: UAT` | ☐ |

Registry shape (Redis key `truesight:channels:registry`, JSON):
`{"channels":[{"id","categoryName","name","visibility","created_at"}],"categories":["…"],"retired":["…"]}`

## Resume tracker

```
RESUME HERE → PR1 (brain registry + endpoints + deploy)
PR0  roadmap ................... ☑ checked in
PR1  brain registry + endpoints  ☐
PR2  channels.js server-backed .. ☐
PR3  app.js wiring .............. ☐
PR4  sync verify + UAT + promote  ☐ gate: UAT
```

## UAT

**R1 — self (before human):**
- [ ] Brain: `GET /channels` returns `{channels,categories,retired}`; `POST/PUT/DELETE` gate on
  governor/sentinel (403 for a guest JWT).
- [ ] `npm test` green; headless test creates a channel, then reloads and sees it restored.

**R3 — human (Gary):**
1. On `localhost:8000`, create a channel + category.
2. Open `chat.truesight.me` (or a second browser) → the same channel/category appears.
3. Rename / retire on one origin → reflects on the other after reload.
4. Pass = channels/categories are shared across origins.

**Out of scope (future):** per-user channel ACLs, channel membership, message history backfill.

## Checklist (operator copy)

- [ ] Plan committed to `sophia_client` (this file).
- [ ] Brain registry endpoint reachable + role-gated.
- [ ] Client reads the shared registry on connect.
- [ ] Create/rename/visibility/retire + category create/delete write to the server.
- [ ] Cross-origin sync verified (localhost ↔ chat.truesight.me).
