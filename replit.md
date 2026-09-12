# Personal AI Secretary

A private Arabic-first secretary that turns natural-language requests into authorized, persisted personal actions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/personal-secretary run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (development only)
- Required env: `DATABASE_URL` — PostgreSQL connection string
- Optional server-only LLM env: `AI_PROVIDER=gemini|groq|development`, provider-specific model variables, and the matching server-only API key

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval from the OpenAPI contract
- Build: Vite for the web app and esbuild for the API

## Where things live

- `lib/api-spec/openapi.yaml` — source-of-truth HTTP contract
- `lib/db/src/schema/personal-secretary.ts` — PostgreSQL schema
- `artifacts/api-server/src/lib/secretary.ts` — persistence boundary and deterministic provider
- `artifacts/api-server/src/lib/phase2.ts` — Gemini gateway, approved tools, and bounded orchestration
- `artifacts/api-server/src/lib/conversation-memory.ts` — bounded Conversation State and separate conversation summaries
- `artifacts/api-server/src/routes/secretary.ts` — authenticated secretary routes
- `artifacts/personal-secretary/src/pages/home.tsx` — Arabic responsive product UI

## Architecture decisions

- The browser only calls the API; it never receives database credentials or the Gemini key.
- `AI_PRIMARY_PROVIDER=gemini|groq` and `AI_FALLBACK_PROVIDER=gemini|groq` configure provider order behind the same runtime boundary. `AI_PROVIDER` remains a backwards-compatible primary-provider alias; the LLM can only invoke registered application tools.
- The deterministic provider is explicit test/development mode only; provider failures do not switch to it automatically.
- Every tool derives tenant and user identity from the authenticated request, not model arguments.
- Conversation memory has three levels: bounded recent Conversation State for follow-ups, canonical Structured Memory in the existing domain tables, and a separate compact summary for long conversations.
- Conversation State and summaries are persisted in PostgreSQL per tenant/user/conversation; ordinary messages are never promoted to Structured Memory automatically.

## Product

- Arabic natural-language conversation for expenses, people, projects, relationships, reminders, tasks, commitments, and Today context.
- Entity resolution asks for clarification when multiple accessible records match instead of choosing randomly.
- Safe multi-step tool execution is bounded to eight calls and 45 seconds per model request.

## User preferences

- Keep Hermes, Telegram, Android native, billing, A2A, and autonomous background behavior out of Phase 2.

## Gotchas

- Run `pnpm -w run typecheck:libs` after changing a shared `lib/*` package so generated declarations are current before checking artifacts.
- The development API token is intentionally a Phase 1/2 boundary and is not production authentication.
- Real-provider failures must not silently claim a write succeeded; use the development provider explicitly when no Gemini key is configured.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.