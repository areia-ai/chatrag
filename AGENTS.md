# ChatRAG Agents Guide

This document is the working guide for anyone, human or AI assistant (Claude, Codex, Cursor, Gemini, etc.), changing the ChatRAG codebase.

---

## 1. Mission & Responsibilities
- Ship and maintain a production-grade AI chat experience featuring Retrieval-Augmented Generation (RAG), multi-model orchestration, and multi-modal creation (text, images, video, 3D).
- Preserve stability, performance, and developer ergonomics across the Next.js 16.0.10 + React 19.2.1 stack.
- Safeguard user data, adhere to Supabase Row Level Security, and prevent secret leakage.

---

## 2. Platform Snapshot
| Layer | Details |
| --- | --- |
| Frontend | Next.js 16.0.10 App Router (React Compiler enabled), React 19.2.1, TypeScript, Tailwind CSS, Framer Motion, Zustand |
| Backend | Next.js API routes, Supabase (PostgreSQL + pgvector HNSW, storage, auth, realtime) |
| AI Stack | Vercel AI SDK 6.0.3 (OpenRouter, OpenAI, Anthropic, DeepSeek, Gemini, MCP integrations) |
| Voice | LiveKit + AssemblyAI STT + Resemble.ai TTS + Silero VAD |
| Integrations | WhatsApp (Baileys), Stripe & Polar payments, Nango (Google Drive/Notion/Dropbox), Meshy/Luma/Runway |

---

## 3. Prerequisites & Core Commands
- Node.js >=20.9.0, npm, Supabase project, API keys for embeddings and preferred models.
- `npm run dev` – boots the app, auto-creates `.env.local` if missing, enables fast refresh.
- `npm run config` – opens the visual configuration dashboard at `http://localhost:3333` for env management, admin users, and RAG prompt tuning.

---

## 4. Development Guidelines
1. Match existing patterns (functional React, strict TS, Tailwind classes, Zustand stores, streaming chat APIs).
2. Prefer Zustand selectors + `useShallow` (from `zustand/react/shallow`) over subscribing to entire stores.
3. Validate all API inputs, return structured JSON errors, prefer streaming responses.
4. Keep comments minimal; only touch documentation by explicit request.
5. Mirror any `.env.local` change in `scripts/init-env.js` and other config defaults.
6. Run lint, type-checks, and relevant scripts before handing off work.
7. Never commit secrets, real phone numbers, or customer data; use placeholder values in tests and docs.

---

## 5. Repository Orientation
```
chatrag/
├── src/
│   ├── app/api/         # Chat, documents, MCP approval, auth, WhatsApp endpoints
│   ├── components/      # UI components and providers
│   │   └── voice/       # Voice mode overlay, orb visualizer
│   └── lib/             # AI providers, RAG pipeline, MCP router, Zustand stores
│       ├── mcp/         # MCP integration
│       └── whatsapp/    # WhatsApp providers
├── voice-agent/         # Real-time voice service (LiveKit, STT, TTS)
├── baileys-whatsapp/    # WhatsApp integration service (Baileys)
├── scripts/
│   ├── config-ui/       # Visual config UI
│   ├── rag/             # RAG diagnostics and reprocessing helpers
│   └── whatsapp/        # WhatsApp helper scripts
└── supabase/            # SQL setup scripts
```

---

## 6. RAG & Data Pipeline
- Keep `RAG_SYSTEM_PROMPT` strings intact with the `{{context}}` placeholder.
- Diagnostics: `node scripts/rag/decode-rag-prompt.js`, `node scripts/rag/check-rag-flow.js`, `node scripts/rag/test-rag-system.js`.
- Supabase stores chats, documents, embeddings, subscriptions, WhatsApp sessions—respect RLS policies.
- Vector search: 1536‑dim embeddings + HNSW indexes (`m=64`, `ef_construction=200`).
- Watch console logs for `[Document Search]` to analyse retrieval behaviour.

### Image RAG
- Images uploaded via Config UI are captioned by GPT-4o Vision and embedded.
- Image chunks stored in `document_chunks` with `metadata.image_url`.
- Retrieved images streamed as `source_images` in chat responses.
- Images displayed above AI text, not cited in sources.

---

## 7. AI Model Management
Models must stay synchronized across **five** locations:
1. `.env.local`
2. `scripts/init-env.js`
3. `src/lib/env.ts`
4. `scripts/config-server.js`
5. `scripts/config-ui/index.html` (three fallback arrays)

`Model` schema:
```ts
interface Model {
  id: string;
  displayName: string;
  isFree?: boolean;
  isOpenSource?: boolean;
  supportsReasoning?: boolean;
  reasoningMethod?: 'effort' | 'max_tokens' | 'both' | 'none';
  contextLength?: number;
  description?: string;
}
```

UI icon cues:
- 🧠 Reasoning/thinking (`supportsReasoning`)
- 🎁 Free model (`isFree`)
- 🔓 Open source (`isOpenSource`)

---

## 8. Voice Integration
Real-time voice conversations powered by:
- **LiveKit** – Audio transport and room management
- **AssemblyAI** – Streaming STT (48kHz, multilingual)
- **Resemble.ai** – TTS with word-level timestamps
- **Silero VAD** – Barge-in detection

Key files:
- `voice-agent/src/voice_agent.ts` – Pipeline, query rewriting, greeting
- `voice-agent/src/agent.ts` – LiveKit, VAD, audio mutex
- `src/components/voice/voice-mode-overlay.tsx` – Frontend voice UI

Running voice agent:
```bash
cd voice-agent && npm run dev
```

---

## 9. Cloud Connectors (Nango)
Unified OAuth for Google Drive, Notion, Dropbox:
- Provider: `@nangohq/node` + `@nangohq/frontend`
- Admin toggles in Config UI → Feature Toggles
- Documents synced to `document_chunks` automatically
- See `README_NANGO_INTEGRATION.md` for OAuth setup

---

## 10. MCP & Tooling
- Intent & tool detection: `src/lib/mcp/query-classifier.ts`, patterns under `src/lib/mcp/query-patterns`.
- Approval & execution pipeline: `src/app/api/chat/approve/route.ts` plus the Universal MCP router/client.
- Cache and approval metadata live on the server—keep tool IDs, schemas, and approval prompts consistent.

---

## 11. WhatsApp Integration
- Provider factory selects Fly.io or Koyeb Baileys deployment via `WHATSAPP_PROVIDER`.
- Baileys service located in `baileys-whatsapp/` subdirectory.
- Client implementations reside in `src/lib/whatsapp/`. Maintain webhook readiness, session persistence, and provider health checks.

---

## 12. Payments & Auth
- Authentication uses Supabase (GitHub OAuth, email/password, magic links); respect multi-tenant RLS.
- Stripe and Polar enable subscriptions and one-off sales—configure secrets only through environment scripts.

---

## 13. Multi-Modal Generation
- Image/video/3D pipelines span `src/lib/` and API routes (Meshy, Luma, Runway, Flux, etc.).
- Preserve status polling, placeholder UI, and Supabase storage URLs when modifying generators.

---

## 14. Behaviour to Preserve
- Strict RAG now allows safe tool results: when `webSearch` is enabled, strict mode may use Exa-powered web search rather than legacy `:online` model suffixes.
- When strict RAG has no useful context and web search is disabled, the chat API returns a structured "information not available" response instead of letting the model answer from general knowledge.
- Source extraction now preserves `webSearch` tool results, document sources, and `source_images` through streaming and final message persistence; keep sidebar toggle click handling intact.
- Voice work recently focused on UI timing and audio reliability: the overlay keeps the three-dot state until text and word timings are ready, the agent dynamically resamples incoming audio for VAD/STT, and Resemble timestamp failures fall back to estimated timings.

---

## 15. Quality Checklist
- Code follows repository style and reuses existing utilities.
- Linting, type-checks, and domain scripts succeed prior to hand-off.
- No sensitive data introduced; configuration arrays remain synchronized.
- Task summaries stay concise and focused.
- Performance guardrails: avoid log spam; scope effects to streaming; prefer `useShallow`.

---

## 16. Handy Scripts
| Command | Description |
|---------|-------------|
| `npm run dev` | Primary app server |
| `npm run config` | Configuration dashboard (port 3333) |
| `cd voice-agent && npm run dev` | Voice agent service |
| `node scripts/rag/*` | RAG health checks |
| `scripts/init-env.js` | Default environment template |

---

## 17. Supplementary Documentation
- **[README_VOICE_INTEGRATION.md](README_VOICE_INTEGRATION.md)** – Voice architecture, mobile support, troubleshooting
- **[README_NANGO_INTEGRATION.md](README_NANGO_INTEGRATION.md)** – Cloud connectors setup
- **[README_DEPLOYMENT_MODES.md](README_DEPLOYMENT_MODES.md)** – Single vs Multi-tenant

Keep this guide current—when architecture or workflows change, update this file so every agent stays aligned.
