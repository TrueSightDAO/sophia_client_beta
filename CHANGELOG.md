# Changelog

## 2026-11-04 — First-party Sophia chat client (chat.truesight.me)

Built and shipped the TrueSight Ops Console — a config-driven, per-deployment
web client that talks directly to a Sophia instance.

**Auth / identity**
- RSA proof-of-possession (`WebCrypto` SPKI/PKCS#8, RSASSA-PKCS1-v1_5/SHA-256),
  identity shared with dapp/capoeira/oracle via `localStorage` `publicKey`/`privateKey`
- Tiered auth via brain `POST /auth-tier` (guest/member/sentinel/governor) → JWT
- "Link to DAO identity" (email → `[EMAIL REGISTERED EVENT]` → Edgar verification)

**Chat**
- SSE `/chat` with streaming (token/tool/done), markdown rendering, attachments
  (`/chat/upload`), auto-scroll, history restore
- Deep-link (`#channel=<id>`), full-history load, JWT auto-refresh on expiry

**Channels / categories**
- Config-driven + localStorage overlay; governor/sentinel create/rename/retire
  channels + categories (right-click context menu, visibility model)

**Deploy**
- GitHub Pages beta/prod fork pair (`sophia_client_beta` → beta.chat.truesight.me,
  `sophia_client_prod` → chat.truesight.me), custom domain + HTTPS

**Brain (truesight_autopilot)**
- `POST /auth-tier` tiered auth endpoint; fixed `settings.debug` 500;
  `chat/upload` allow-sentinel
