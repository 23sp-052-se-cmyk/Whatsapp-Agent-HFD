# WhatsApp AI Conversation Platform — Architecture & Restructuring Plan

> A multi-tenant SaaS where businesses connect WhatsApp numbers and get an AI agent
> that automates and improves conversations with their leads and customers — with
> strict per-business data isolation.

**Status:** Draft v1 — for review
**Last updated:** 2026-05-19

---

## 1. Executive Summary

You are building a SaaS platform with three intertwined problems to solve well:

1. **Connectivity** — reliably send/receive WhatsApp messages on behalf of many businesses.
2. **Intelligence** — an AI agent per business, trained on *their* niche, that automates
   conversations and improves over time from *their own* data only.
3. **Isolation & trust** — every business's data (contacts, conversations, knowledge,
   training signal) is provably walled off from every other business, and the platform
   is compliant enough to sell into regulated and privacy-sensitive markets.

The single most important architectural decision in this whole document:

> **Do not pool customer conversation data to train one shared model.**
> Instead, give each tenant a private knowledge base + retrieval (RAG) and
> per-conversation memory. This is simultaneously the *privacy-correct* choice
> and the *quality-correct* choice (no cross-niche bleed). It also makes GDPR
> "right to erasure" tractable.

A second important note up front: **your chosen channel is Baileys (unofficial
WhatsApp Web).** It works, but number bans are a real, ongoing operational risk and
the system must be built around stateful socket management. See §6 for the
Baileys-specific architecture, and keep the official Cloud API on the roadmap as a
future Pro/Enterprise tier.

---

## 2. Product Overview

| Aspect | Description |
|---|---|
| **What it is** | A web dashboard ("the board") where a business connects one or more WhatsApp numbers, configures an AI agent, trains it on their domain, and watches/steers automated conversations with their customers and leads. |
| **Primary value** | Faster, always-on, on-brand customer conversations without hiring more agents. |
| **Buyer** | SMBs, agencies, sales teams, support teams, solo operators with high WhatsApp inbound. |
| **Monetization** | Tiered SaaS subscription + usage metering (messages, AI tokens, connected numbers). |
| **Core differentiator** | Niche-trained agent + strong tenant data isolation + a CRM-style conversation board. |

---

## 3. Glossary (shared vocabulary — use these terms everywhere)

- **Tenant / Organization** — a paying business account. The hard isolation boundary.
- **Workspace** — optional sub-grouping inside a tenant (e.g. brands or departments).
- **Member / Role** — a human user inside a tenant (Owner, Admin, Agent, Viewer).
- **Channel** — one connected WhatsApp number (Baileys socket now; Cloud API later).
- **Contact** — an end customer the business talks to via WhatsApp.
- **Conversation** — the message thread between a Channel and a Contact.
- **Agent (AI)** — the configured automation persona for a tenant/channel.
- **Knowledge Base (KB)** — tenant-private documents/FAQs/snippets used for RAG.
- **Pipeline / Board** — Kanban-style stages a conversation moves through (e.g. New → Qualifying → Quoted → Won).
- **Handoff** — escalation from AI to a human member.
- **Template** — pre-approved WhatsApp message used to start/re-open conversations outside the 24-hour window.

---

## 4. Personas & Roles

| Role | Can do |
|---|---|
| **Owner** | Billing, delete org, manage all members, everything below. |
| **Admin** | Connect channels, configure agents, manage KB, manage members (not billing/delete). |
| **Agent** | View/handle conversations, take over from AI, reply, move pipeline cards. |
| **Viewer** | Read-only dashboards and conversations. |
| **End Customer** | Not a platform user — interacts only via WhatsApp. Treated as **untrusted input** (see §8.4). |

---

## 5. Core Features (functional scope)

### 5.1 Onboarding & Channel Connection
- Guided setup wizard: create org → connect WhatsApp number → import/enter knowledge → test agent → go live.
- Channel health monitor (connected / degraded / disconnected / rate-limited / banned).
- Re-connect / re-auth flow with clear status.

### 5.2 The Board (conversation workspace)
- Inbox view: all conversations, filters (unread, AI-handled, needs-human, pipeline stage, tag, channel).
- Kanban pipeline view: drag conversations across customizable stages.
- Conversation view: full message history, AI suggestions, "AI is handling / paused", one-click human takeover, internal notes (not sent to customer), tags, assignment.
- Contact profile: history, attributes, consent status, custom fields.

### 5.3 Agent Configuration & Training
- Persona settings: name, tone, language(s), business hours behavior, fallback rules.
- Knowledge base: upload docs (PDF/DOCX/TXT/URL/CSV), FAQ pairs, product catalog; auto-chunked + embedded into the **tenant-private** vector store.
- Behavior rules: when to auto-reply vs. ask for human, what it must never say, escalation triggers, collect-this-info goals (e.g. capture name + intent + budget).
- Test sandbox: chat with the agent using current config before publishing; versioned configs with rollback.
- **Improvement loop:** thumbs up/down + corrections on AI replies feed a tenant-scoped review queue → curated examples added to that tenant's KB / few-shot set. (Not a shared model — see §8.)

### 5.4 Automation & Workflows
- Auto-reply within WhatsApp's 24h customer-service window.
- Template-based outbound (re-engagement, follow-ups) with opt-in checks.
- Triggers/actions: tag, move pipeline stage, notify member, call webhook, hand off.

### 5.5 Sales & Critical-Event Notifications (real-time alerts to the admin)
The agent should proactively alert the main admin when something important happens
in a conversation — not make them watch the board all day.

- **Event detection (by the AI during the conversation):**
  - **Sale / conversion** — customer agrees to buy, confirms an order, asks to pay.
  - **Critical / at-risk** — high-value lead, customer angry or about to churn,
    explicit complaint, competitor mention, urgent deadline, repeated unresolved
    question, or AI low-confidence on a hot lead.
  - **Handoff needed** — agent decided a human must step in.
- The AI classifies each conversation turn and emits a structured event
  (`type`, `severity`, `confidence`, `conversation_id`, short reason summary).
  Tenants can configure which events alert and the thresholds.
- **Delivery channels (per tenant preference):**
  - **WhatsApp to the admin** — the business number (or a dedicated notifier
    number) sends the admin a concise alert with a deep link to the conversation
    on the board. *(Note the WhatsApp constraint in §5.5.1.)*
  - In-app real-time notification + optional email.
- Quiet hours, per-event-type routing, and de-duplication (don't spam 5 alerts
  for one deal) are configurable.

#### 5.5.1 WhatsApp-notification constraint (important)
Sending an *unsolicited* WhatsApp message to the admin (outside a 24-hour window)
is exactly the kind of proactive send WhatsApp polices. With **Baileys this is a
ban-risk vector** and on the official API it requires an approved template.
Recommended design:
- Default admin alerts to **in-app + email** (no WhatsApp policy risk, instant).
- Offer **WhatsApp admin alerts as opt-in**, ideally from a **separate dedicated
  notifier number** (so a ban hits the notifier, not the revenue-generating
  customer number), with strict rate limits. Treat this as a deliberate,
  risk-acknowledged choice — documented in the UI.

### 5.6 Scheduled Digests / Reports (daily / weekly / monthly)
- Per-admin (or per-workspace) **subscription to a recurring summary**, frequency
  configurable: **daily, weekly, or monthly**, with send time + timezone (default
  Asia/Karachi).
- Contents (AI-generated, tenant-scoped only): new conversations, leads captured,
  sales/conversions, at-risk/critical items, top customer intents, response &
  automation metrics, items needing human follow-up.
- Delivery: **email and/or in-app by default**; WhatsApp delivery optional under
  the same constraint as §5.5.1 (prefer template/dedicated number).
- Generated by a scheduled job per tenant; the summary itself is produced by the
  LLM from that tenant's data only (never cross-tenant).

### 5.7 Localization — Roman Urdu & code-mixed English (Pakistan-first)
- Most customers write **Roman Urdu** (Urdu in Latin script, mixed with English).
  This is a **prompting/persona** concern, not translation: instruct the agent to
  detect Roman Urdu and **reply in Roman Urdu** to mirror the customer; fall back
  to English or Urdu script if the customer uses those.
- Per-tenant language/style settings (default reply language, allow script
  switching, brand glossary of product/term spellings).
- Keep transcripts in their original form; store a detected-language tag per
  message for analytics and digests.

### 5.8 Voice Notes — speech-to-text in, text (or optional voice) out
- WhatsApp voice notes arrive as OGG/Opus. Pipeline: download media → convert
  (ffmpeg) → **speech-to-text** → feed text to the agent like any other message.
- **STT:** OpenAI **Whisper** (open-source, MIT, free to self-host) via
  **faster-whisper** for speed; optionally an Urdu-fine-tuned Whisper checkpoint
  for better Pakistani-Urdu accuracy. Voice notes are asynchronous, so a few
  seconds of latency is acceptable — no GPU strictly required at low volume.
- **Script note:** Whisper outputs spoken Urdu as **Urdu script**, while text
  customers use **Roman Urdu**. The agent should reply in Roman Urdu text for
  consistency (configurable), so normalize at the agent layer, not the STT layer.
- **Reply mode:** default to **text replies** (cheaper, reliable, re-readable).
  Voice replies (TTS) are an **optional/premium** later add-on — free Urdu TTS
  quality (natural Pakistani accent) is currently weak; don't ship it as default.

### 5.9 Analytics
- Volume, response time, automation rate, deflection, handoff rate, CSAT (if collected).
- Per-channel and per-agent breakdowns; export.

### 5.10 Admin / Billing
- Subscription & plan management, usage meters, invoices, seat management.
- Audit log of sensitive actions.

---

## 6. WhatsApp Integration Layer — Baileys (read this carefully)

**Confirmed stack: Baileys** (reverse-engineered WhatsApp Web multi-device socket
library). This is the unofficial path. It is functional and widely used, but it is
**against WhatsApp's Terms of Service, and number bans are a real, ongoing
operational risk** — heightened by automated sends across many numbers in a
multi-tenant SaaS. You can *reduce* ban risk, not eliminate it. Be explicit about
this with your own customers (risk acknowledgment at channel connect); it protects
you legally and sets expectations.

> Keep the official WhatsApp Business Platform (Cloud API) on the roadmap as a
> future Pro/Enterprise tier (see §6.7) — larger customers will not accept ban
> risk, and it is a natural upsell. The Channel abstraction below makes that
> additive, not a rewrite.

### 6.1 The core challenge: socket lifecycle + sharding
Each connected number is **one live Baileys socket holding Signal-protocol crypto
state in memory** in a Node process. A single process holds only a finite number of
sockets. This forces a dedicated **Connection Manager service**:

- A pool of **socket-worker processes**, each owning N sockets (tune N via load testing).
- A **connection registry**: `channel_id → worker node` holding that socket (in Redis/DB).
- **Outbound routing**: a send for `channel_id` must reach the worker that owns the
  socket — queue with worker affinity, or registry lookup + direct dispatch.
- Workers are stateful; design deploys/restarts to drain and rebalance sockets, not
  drop them all at once.

### 6.2 Custom DB-backed auth state — mandatory for SaaS
- **Do not use `useMultiFileAuthState`** (writes session files to disk; not viable
  multi-tenant or multi-worker).
- Implement a custom auth-state adapter persisting `creds` + Signal keys per channel
  into Postgres/Redis, **encrypted at rest with KMS**. Each channel = its own
  isolated credential set. This is the WhatsApp-layer half of tenant isolation.
- Wrap signal keys with `makeCacheableSignalKeyStore` to cut DB round-trips.

### 6.3 Connection state machine
Handle `connection.update` and branch on `DisconnectReason`:
- `loggedOut` → credentials dead → mark channel **disconnected**, surface "reconnect
  required" on the board, require re-pairing. Do **not** auto-retry.
- `restartRequired` → recreate the socket with saved creds.
- `connectionClosed` / `connectionLost` / `timedOut` → exponential-backoff reconnect
  reusing saved creds.
- **Banned** → first-class channel state with clear customer messaging; stop sends.

### 6.4 Onboarding / pairing — **QR scan (primary flow)**
The business owner connects by scanning a QR code with WhatsApp → Linked Devices.

Mechanics that must be handled:
- Baileys emits a `qr` string on `connection.update` when a socket has no saved
  creds. Stream it to the owner's browser in **real time (WebSocket/SSE)** and
  render client-side.
- **The QR rotates** (~every 20s, only a few cycles). Push each new `qr` and
  re-render with a countdown; after cycles exhaust, show **expired → retry**
  (restarts the socket's pairing).
- On scan, Baileys fires `connection: 'open'` → persist creds to the encrypted
  per-channel store → mark channel **connected** → stop streaming QR.
- QR is required **only for first link or after `loggedOut`**. Normal reconnects
  reuse saved creds silently — never re-prompt for QR on transient drops.
- **Worker affinity:** the socket generating the QR must be the same socket/worker
  that holds the live session afterward. The connection manager allocates the
  target worker *before* showing the QR and routes the QR stream from that worker
  to that browser session.
- **Security:** the QR is a session-pairing secret. Bind the QR stream to the
  authenticated member's session, never expose it via a public/guessable URL,
  short TTL, never log it.
- Wizard state machine: `initializing → qr_ready (refresh per rotation) →
  authenticating → connected`, with `expired` / `failed` → retry branches.
- (Optional) offer the pairing-code flow as a secondary fallback for users who
  can't scan.

### 6.5 Memory & store discipline (top production failure mode)
- Persist messages to **your** database; do **not** rely on Baileys' in-memory store.
- Cap all in-memory caches; use cacheable signal key store.
- Monitor per-worker memory; recycle workers on thresholds. Unbounded growth per
  socket is the #1 cause of outages in Baileys deployments.

### 6.6 Ban-risk mitigation (reduces, does not eliminate)
- Warm up new numbers (gradual ramp), per-number outbound rate limits, human-like
  pacing + jitter, avoid identical bulk blasts, exponential backoff on send errors,
  presence/typing simulation. Track a per-channel "health score".

### 6.6.1 Number resilience / failover
- Let a tenant register **backup number(s)** for a channel. On ban/disconnect of
  the primary, surface the state, alert the admin, and support routing new
  conversations to a healthy backup so a single ban doesn't take the business
  fully offline. Keep contact/conversation continuity per tenant across numbers.

### 6.7 Version & protocol risk
- **Pin the Baileys version**; WhatsApp changes the protocol and upstream updates
  can break in production. Monitor upstream, keep a tested upgrade path, and have a
  rollback plan.

### 6.8 Channel Abstraction (keep this even on Baileys-only)
Provider-agnostic interface so the rest of the system never depends on Baileys:

```
ChannelProvider
  ├─ sendMessage(channelId, to, content) -> messageId
  ├─ sendTemplate(channelId, to, templateId, vars)   // future: Cloud API
  ├─ onInboundMessage(handler)         // normalized event
  ├─ onStatusUpdate(handler)           // delivered/read/failed
  └─ healthCheck(channelId) -> status
Implementations: BaileysProvider (now), CloudApiProvider (future tier),
                 (future: Telegram, IG, SMS)
```

This makes the future official-API tier and other channels additive, not a rewrite.

---

## 7. System Architecture (high level)

```
                         ┌────────────────────────┐
                         │   Web App (Next.js)     │  ← members use "the board"
                         └───────────┬────────────┘
                                     │ HTTPS / WS
                         ┌───────────▼────────────┐
                         │       API Gateway       │  authn/z, tenant context,
                         │   (BFF + REST/WS)       │  rate limits
                         └───────────┬────────────┘
            ┌────────────────────────┼─────────────────────────────┐
            ▼                        ▼                              ▼
   ┌────────────────┐     ┌────────────────────┐        ┌───────────────────┐
   │ Core Service   │     │  AI / Agent Service │        │ Channel Service   │
   │ (orgs, board,  │     │  (RAG, memory,      │        │ (Baileys socket   │
   │  pipeline, KB  │     │   guardrails,       │        │  worker pool +    │
   │  metadata)     │     │   reply generation) │        │  registry/queue)  │
   └───────┬────────┘     └─────────┬──────────┘        └─────────┬─────────┘
           │                        │                              │
   ┌───────▼────────┐     ┌─────────▼──────────┐        ┌──────────▼────────┐
   │ PostgreSQL     │     │ Vector store       │        │ Message queue     │
   │ (RLS, tenant_id│     │ (per-tenant        │        │ (Redis/Kafka)     │
   │  on every row) │     │  namespace)        │        │ + worker pool     │
   └────────────────┘     └────────────────────┘        └───────────────────┘
           │
   ┌───────▼────────┐   ┌─────────────┐   ┌──────────────┐
   │ Object storage │   │ Billing     │   │ LLM provider │
   │ (media, docs)  │   │ (Stripe)    │   │ (e.g.        │
   └────────────────┘   └─────────────┘   │  Anthropic)  │
                                          └──────────────┘
```

**Why split AI and Channel into their own services:** they scale, fail, and get
deployed on very different cadences than the core CRUD app. Channel workers must
absorb webhook spikes and respect strict outbound rate limits; the AI service is
latency- and cost-sensitive and needs independent autoscaling.

### 7.1 Inbound message flow
1. WhatsApp → Channel Service webhook (verified signature).
2. Normalize → enqueue with `tenant_id` + `channel_id` + `conversation_id`.
3. Worker loads conversation context (DB) + retrieves tenant-private KB chunks (vector store, **namespace = tenant_id**).
4. AI Service composes reply under guardrails; decides auto-send vs. handoff.
5. If auto: Channel Service sends; status updates tracked. If handoff: flagged on the board, member notified.

### 7.2 Multi-region / data residency
- Region-pin tenants (EU data stays in EU) to satisfy residency commitments — cheaper to design in now than retrofit. At minimum: region-aware storage + LLM endpoint selection.

---

## 8. AI / Agent Layer & the Isolation Model (the core of your privacy promise)

### 8.1 Per-tenant RAG, not shared fine-tuning
- Each tenant has a **private vector namespace**. KB docs and curated good replies are embedded there.
- At reply time: retrieve only from `namespace == tenant_id`. The LLM sees system prompt + tenant persona + retrieved tenant chunks + recent conversation. **No other tenant's data can enter the prompt.**
- "The system uses conversations exclusively to make *that* customer's interactions better" is satisfied because improvement signal is written back **only** into the originating tenant's namespace/example set.

### 8.2 Conversation memory
- Short-term: recent turns in the thread.
- Long-term: per-contact summary/attributes (tenant-scoped).
- Never use one tenant's transcripts as context, retrieval, or examples for another.

### 8.3 If you ever want model fine-tuning
- Do it **per-tenant** (a private adapter), never a pooled model — unless you have explicit, separate, opt-in consent and the data is robustly anonymized. Default: don't. RAG + few-shot covers ~90% of value with far less risk.

### 8.4 Guardrails — the agent talks to untrusted strangers
End customers are **untrusted input**. Treat their messages as potential prompt injection.
- Strict separation of system instructions vs. customer content; never let customer text redefine the agent's role, reveal the system prompt, or extract KB wholesale.
- Output filters: no leaking of other contacts' data, no unauthorized commitments (pricing/refund promises) beyond configured policy, PII minimization.
- Hard "never say" list per tenant; profanity/abuse handling; rate-limit per contact.
- Confidence threshold → auto-handoff when unsure.
- Full prompt/response logging (tenant-scoped) for audit and eval.

### 8.5 Quality / eval harness
- Golden test sets per tenant + regression runs on agent-config changes.
- Online metrics: handoff rate, correction rate, CSAT. Treat the thumbs-down queue as the training-data pipeline.

---

## 9. Multi-Tenancy & Data Isolation (engineering specifics)

| Concern | Approach |
|---|---|
| **Relational data** | Single Postgres, `tenant_id` NOT NULL on every tenant-owned table, **Row-Level Security (RLS)** policies enforced at the DB, app sets tenant context per request/connection. |
| **Vector data** | Per-tenant namespace/collection; queries always filtered by tenant. |
| **Object storage** | Per-tenant prefix/bucket; signed URLs scoped + short-lived. |
| **Caching/queues** | Tenant-scoped keys; never a cache key that can collide across tenants. |
| **Secrets (channel tokens)** | Encrypted at rest (KMS), per-tenant; never logged. |
| **Background jobs** | Carry `tenant_id` in the job payload; workers re-assert RLS context. |
| **Tenant deletion** | One documented procedure that purges relational rows, vectors, objects, caches, backups-on-schedule, and LLM logs → enables GDPR erasure. |
| **Noisy-neighbor** | Per-tenant rate limits + usage quotas so one tenant can't starve others. |

> **Hard rule:** there must be **no code path** that returns data without a tenant
> filter. Enforce it at the DB (RLS) so an app-layer bug can't leak across tenants.
> Add an automated test that fails the build if a tenant-owned query lacks a tenant predicate.

---

## 10. Data Model (key entities — abbreviated)

```
Organization(id, name, plan, region, created_at, status)
Member(id, org_id, email, role, status)
Channel(id, org_id, provider, phone, status, credentials_ref, created_at)
Contact(id, org_id, channel_id, wa_id, name, attributes_json, consent_status)
Conversation(id, org_id, channel_id, contact_id, state, pipeline_stage,
              assigned_member_id, ai_mode[auto|paused|off], last_msg_at)
Message(id, org_id, conversation_id, direction, type[text|audio|image|...],
         body, media_ref, transcript, detected_lang, wa_message_id, status, created_at)
AgentConfig(id, org_id, version, persona_json, rules_json, reply_lang_policy,
            is_published)
KnowledgeItem(id, org_id, source_type, title, storage_ref, status)
KnowledgeChunk(id, org_id, knowledge_item_id, vector_id, text)   // vector in tenant namespace
ReviewItem(id, org_id, message_id, verdict, correction_text, status)  // improvement loop
ConversationEvent(id, org_id, conversation_id, type[sale|critical|handoff|...],
                  severity, confidence, summary, created_at)        // §5.5
NotificationRule(id, org_id, event_type, channels[inapp|email|whatsapp],
                 threshold, quiet_hours, target_member_id, dedupe_window)
DigestSchedule(id, org_id, member_id, frequency[daily|weekly|monthly],
               send_time, timezone, channels[email|inapp|whatsapp], last_run_at)
NotificationLog(id, org_id, rule_id, event_id, channel, status, sent_at)
UsageEvent(id, org_id, kind[message|ai_token|stt_minute|channel], qty, occurred_at)
AuditLog(id, org_id, actor_id, action, target, metadata, created_at)
Subscription(id, org_id, plan, status, current_period, stripe_ref)
```
Every tenant-owned table carries `org_id` and is covered by RLS.

---

## 11. SaaS Model & Monetization

Because AI + WhatsApp have **real variable cost per message**, pure flat pricing
will bleed margin. Use **tier + metered usage**.

| Tier | Target | Typical limits | Notes |
|---|---|---|---|
| **Starter** | Solo / trial | 1 channel, 1 agent, capped AI conversations/mo, community support | Baileys channel (risk-disclosed at connect) |
| **Growth** | SMB | Multiple channels, pipeline, analytics, more usage, email support | Baileys; per-number throttling enforced |
| **Pro / Business** | Teams | Higher seats, more channels, advanced rules, priority support | Official Cloud API option (future) as ban-free upsell |
| **Enterprise** | Regulated / large | Data residency, SSO, DPA, custom limits, SLA, audit exports | Annual contract |

**Metering dimensions:** AI conversations or tokens, messages sent, connected
numbers, seats, KB storage. Emit a `UsageEvent` for everything billable and
reconcile to Stripe. Show usage + soft/hard caps in-app to avoid bill shock.

**Billing stack:** Stripe (subscriptions + usage-based/metered billing), webhooks
→ subscription state machine, dunning for failed payments, in-app upgrade/downgrade.

---

## 12. Security & Compliance

- **Tenant isolation** as §9 — the foundation of the trust story.
- **GDPR/privacy:** lawful basis + consent capture for end customers, DPA with tenants (you are processor, tenant is controller), sub-processor list, data export & **erasure** per tenant/per contact, data minimization, configurable retention (auto-purge old conversations).
- **Local law (Pakistan-first):** you operate from and sell into Pakistan — account for **PECA** and the forthcoming Pakistani personal-data-protection regime alongside GDPR, plus local anti-spam/electronic-communication rules. Maintain a clear lawful basis for processing customer conversations; surface consent/opt-out to end customers.
- **WhatsApp policy:** honor opt-in, 24-hour window, approved templates only for outbound re-engagement; abuse/spam controls.
- **AuthN/Z:** SSO/OAuth + optional SAML (enterprise), MFA, RBAC, short-lived sessions.
- **Secrets:** KMS-encrypted channel tokens; never in logs or client. Short-lived, scoped tokens only; no long-lived publish/cloud creds on dev machines or CI runners.
- **Transport/at rest:** TLS everywhere; encryption at rest for DB, objects, backups.
- **App security:** signed/verified WhatsApp webhooks, input validation, prompt-injection defenses (§8.4), rate limiting, dependency scanning.
- **Support access:** any staff access to tenant data is least-privilege, time-boxed, and fully audit-logged (privacy commitment).
- **Operational:** audit log, access reviews, incident response plan, backup + tested restore, least-privilege infra.
- **Compliance roadmap:** design toward SOC 2 Type II early (it unlocks bigger customers); GDPR-ready from day one.

### 12.1 Supply-Chain & Dependency Security (active threat — not optional)
The npm ecosystem is under a sustained, self-propagating worm campaign
("Shai-Hulud" / "Mini Shai-Hulud", multiple waves through 2025–2026) that injects
**install-time hooks** to steal npm/GitHub/cloud credentials and re-publishes
infected versions of legitimate packages. Recent waves compromised packages
directly relevant to this stack (TanStack React Router, Mistral AI tooling,
Bitwarden CLI, intercom-client, Axios) and persist payloads in `.claude/` and
`.vscode/` that survive uninstall. Controls for this project:

- **Package manager: pnpm** (not npm). Configure it to **not run dependency
  lifecycle scripts by default**; allowlist only packages that truly need a build
  step. (The malware executes via `preinstall`/`postinstall`.)
- **Frozen, pinned, hash-verified installs:** commit lockfile, pin exact versions
  on critical deps (no `^`/`~`), `pnpm install --frozen-lockfile` in CI, add a
  publish-age cooldown before adopting new versions.
- **No `npx`/`pnpm dlx` of untrusted packages; no `curl | bash` installers.**
- **GitHub Actions hardening:** pin actions to commit SHAs, restrict
  `pull_request_target`, minimize/scoped `GITHUB_TOKEN`, isolate CI secrets.
- **Credential hygiene:** short-lived scoped tokens; no broad npm publish or cloud
  admin keys on laptops/runners (this is exactly what the worm harvests).
- **Treat Baileys as a high-value target:** pin version, review the diff before
  every upgrade, never auto-update.
- **Tooling:** dependency/SBOM scanner (e.g. Socket/Snyk) in CI; ideally a
  **private registry proxy with an allowlist** controlling which versions enter
  builds. Watch for and purge persisted payloads in `.claude/`/`.vscode/`.

### 12.2 Platform Anti-Abuse & Tenant Vetting (existential for a WhatsApp SaaS)
A WhatsApp automation SaaS is a magnet for spammers and scammers. Tenant abuse
gets **your** infrastructure, IPs, and numbers banned and creates legal exposure
(PECA, anti-spam law). Required:

- **Acceptable-Use Policy** + enforced agreement at signup; prohibited use list.
- **Tenant onboarding checks** (basic KYC/business verification scaled by tier;
  stricter for high-volume outbound).
- **Outbound abuse monitoring:** detect spam patterns, mass identical sends,
  scam/phishing content, complaint spikes; per-tenant rate caps.
- **Per-tenant kill switch** to suspend a tenant instantly on abuse.
- **Customer opt-out / STOP handling** honored automatically and globally.

### 12.3 Disaster Recovery (beyond backups)
- Define **RPO/RTO** per data class; automate backups *and* **test restores**.
- Off-site, access-controlled, encrypted backups isolated from prod creds (the
  worm's "wipe home directory" behavior makes this concrete, not theoretical).
- Documented runbooks: registry compromise, mass channel ban, data-loss event.

---

## 13. Recommended Tech Stack (opinionated, swap as you see fit)

| Layer | Recommendation | Why |
|---|---|---|
| Frontend | Next.js + React + TypeScript + Tailwind | Fast board UI, SSR, WS for live inbox |
| API/Core | Node.js (NestJS) **or** Python (FastAPI) | Pick one; Node aligns with WhatsApp libs, Python with AI tooling |
| AI service | Python (FastAPI) | Best ecosystem for RAG/embeddings/evals |
| Channel service | Node.js + **Baileys**, stateful socket-worker pool + connection registry | Baileys is Node-only; sockets are stateful and must be sharded across workers |
| DB | PostgreSQL + Row-Level Security | Strong, simple tenant isolation in one DB |
| Vectors | pgvector (start) → Qdrant/Pinecone (scale) | Start cheap in Postgres; migrate if needed |
| Queue | Redis + BullMQ (start) → Kafka (scale) | Absorb webhook spikes, control outbound pacing |
| Object storage | S3-compatible | Media + KB documents |
| LLM | A hosted LLM API (e.g. Anthropic's Claude API) | Strong instruction-following + tool use for agents; verify current models/pricing before committing |
| Speech-to-text | **faster-whisper** (Whisper, MIT, self-host) + ffmpeg; optional Urdu-fine-tuned checkpoint | Free, async-friendly, handles Urdu; no GPU needed at low volume |
| Text-to-speech (optional/later) | Open-source Urdu TTS (e.g. WhisperSpeech) — premium feature only | Free Urdu TTS quality is weak today; keep text-first |
| Scheduler | Cron/queue-based scheduled jobs (per-tenant) | Drives digests + recurring reports |
| Billing | Stripe | Subscriptions + metered usage |
| Infra | Containers + managed orchestration, IaC | Independent scaling of AI/Channel/Core |
| Package manager | **pnpm** with dependency lifecycle scripts disabled by default + frozen lockfile | Reduces install-time supply-chain attack surface (§12.1) |
| Supply-chain tooling | Dependency/SBOM scanner (Socket/Snyk) in CI + private registry proxy/allowlist | Active npm worm campaign (§12.1) |
| Observability | Centralized logs/metrics/traces + LLM tracing | Debug agent behavior and cost per tenant |

> Note: confirm specific LLM model names, context limits, and pricing from the
> provider's current docs before finalizing — those change frequently.

---

## 14. Non-Functional Requirements

- **Availability:** target 99.9% for the board and webhooks; degrade gracefully (queue inbound if AI is down).
- **Latency:** AI reply target < 3–5s typical; show typing indicator.
- **Scalability:** horizontal scaling of AI/Channel workers; per-tenant quotas.
- **Reliability:** at-least-once message processing with idempotency keys (WhatsApp can redeliver webhooks).
- **Cost control:** per-tenant token/cost tracking; cache retrieval; cheaper model routing for simple turns.
- **Observability:** trace a message end-to-end with tenant + conversation IDs.

---

## 15. Restructuring / Migration Plan (phased)

You said you're restructuring the **whole** app — do it in slices, not a big bang.

**Phase 0 — Foundations**
- Lock the tenant model + RLS. Introduce the Channel abstraction interface.
- Stand up Core / AI / Channel service boundaries (even if some start as modules in one deploy).

**Phase 1 — Isolation & Baileys channel hardening**
- Migrate data so every tenant-owned row has `org_id` + RLS enforced.
- Custom DB-backed encrypted auth-state store; socket-worker pool + connection
  registry; reconnection state machine; QR-scan onboarding (real-time QR stream).
- Baileys provider end-to-end (inbound→AI→outbound) behind the Channel interface.
- Per-tenant vector namespaces; KB ingestion pipeline.

**Phase 2 — The board & agent**
- New inbox + pipeline UI, human takeover, agent config + sandbox, guardrails.
- Improvement (thumbs/correction) loop writing back per-tenant.
- **Roman Urdu / code-mixed handling** in agent persona + reply-language policy.
- **Voice notes:** Whisper/faster-whisper STT pipeline → text replies.

**Phase 3 — Notifications, digests & SaaS**
- ConversationEvent detection (sale / critical / handoff) by the AI.
- Notification rules (in-app + email first; opt-in WhatsApp via dedicated notifier number).
- Scheduled daily/weekly/monthly digests (per-admin, timezone-aware).
- Plans, metering, Stripe, quotas, in-app usage, audit log.

**Phase 4 — Compliance & scale**
- GDPR tooling (export/erasure), data residency, SOC 2 prep, analytics, eval harness.
- (Optional) official Cloud API provider as a ban-free Pro/Enterprise tier.

**Phase 5 — Expansion**
- Additional channels (Instagram/Telegram/SMS) via the same abstraction; team features; integrations/webhooks/API.
- Optional **voice replies (Urdu TTS)** as a premium add-on once quality is validated.

Each phase should be shippable and reversible. Keep the old system running per-tenant
behind a feature flag during cutover.

---

## 16. Suggested Improvements & Open Questions

**Improvements I'd push for:**
1. **Engineer around Baileys' weaknesses, not against them.** Stateful socket-worker pool + DB-backed encrypted auth state + a real reconnection/ban state machine are non-negotiable; disclose ban risk to customers; keep the official Cloud API as a future ban-free upsell tier.
2. **Per-tenant RAG instead of a shared trained model** — better privacy *and* better answers; makes GDPR erasure feasible.
3. **First-class human handoff.** Full automation will frustrate customers on edge cases; a clean AI↔human takeover is a selling point, not an afterthought.
4. **Treat end customers as untrusted input** — prompt-injection defense from day one, since strangers are literally typing into your LLM.
5. **Usage-based component in pricing** — protects margin against variable AI/WhatsApp cost.
6. **Enforce isolation at the database (RLS)**, not just app code, plus a build-time test that blocks un-scoped queries.
7. **Design data residency early** even if only EU/US at first.
8. **Opt-in & template management as product features** (WhatsApp requires them; if it breaks, the whole product breaks).
9. **Eval harness + thumbs-down → training queue** so "it improves over time" is real and measurable, not vibes.

**Open questions for you:**
- How many numbers/tenant do you expect at launch and in 12 months? (Sizes the socket-worker pool and is the key Baileys scaling input.)
- Who owns the WhatsApp Business Account — you (BSP-style) or each tenant?
- Target customer size: many tiny self-serve tenants vs. fewer larger ones? (Changes isolation/billing tradeoffs.)
- Required initial regions / data-residency commitments?
- Do you need outbound proactive campaigns (templates) at launch, or inbound-only first?
- Existing stack you're restructuring *from* (so the migration plan can be concrete)?
- Languages/markets at launch (affects model choice + templates + moderation)?

---

## 17. Top Risks

| Risk | Mitigation |
|---|---|
| **Baileys number bans** (primary operational risk) | Per-number warm-up + rate limits + human pacing; first-class banned state; customer risk disclosure; official Cloud API as future fallback tier |
| Socket-worker overload / memory leak | Sharded socket pool with capacity limits, cacheable key store, persist messages to DB, per-worker memory monitoring + recycling |
| Baileys protocol breakage on upstream/WhatsApp change | Pin version, monitor upstream, tested upgrade + rollback path |
| **npm supply-chain worm (active)** | pnpm + scripts disabled, frozen/pinned installs, scanning, registry allowlist, credential hygiene (§12.1) |
| **Platform abused for spam/scams → mass bans + legal exposure** | AUP, tenant vetting, outbound abuse monitoring, per-tenant kill switch (§12.2) |
| Single banned number takes a business fully offline | Backup numbers per tenant + automatic failover; notify admin |
| Cross-tenant data leak | DB-enforced RLS, per-tenant vector namespaces, build-time guard test, audits |
| Prompt injection via customer messages | Strict instruction/content separation, output filters, handoff on low confidence |
| AI cost overrun | Per-tenant metering + caps, model routing, retrieval caching |
| Compliance gaps blocking enterprise deals | GDPR-ready + SOC 2 roadmap from the start |
| Big-bang rewrite stalls | Phased, per-tenant, feature-flagged cutover |

---

*End of plan. Tell me which open questions you can answer and I'll tighten the
relevant sections — e.g. lock the tech stack, detail the data model, or expand the
migration plan into concrete tickets.*
