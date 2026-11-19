# Rowsmith

Upload a CSV, describe the fields to fill, and get every row filled with web-grounded, schema-validated, sourced data, plus the cost per row. Open source under AGPL-3.0.

The guiding rule: **a cell is filled only if a cited source states it.** Otherwise it stays blank with a reason. Don't loosen this to fill more cells.

## Working rules

- Read the code around a change before writing it. If something is unclear, ask; don't guess.
- Use **pnpm** only.
- Before calling work done, run `pnpm typecheck`, `pnpm lint` and `pnpm test`, and fix all errors.
- `pnpm eval` and `pnpm eval:lists` call the real Gemini APIs and cost money. Run them only when asked.
- Next.js is 16.4.3 and differs from older versions. Check `node_modules/next/dist/docs/` before using a Next API (see `AGENTS.md`).
- Model prices live in `MODEL_CATALOG` (`engine/llm/models.ts`), copied from Google's pricing page. Never guess a price: check the page, cite its "last updated" date, and add announced price changes with their dates.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm worker:dev` | App and worker for development (run both, separate terminals) |
| `pnpm build` / `pnpm start` / `pnpm worker:start` | Production |
| `pnpm typecheck` | `next typegen && tsc --noEmit`. Typegen creates global helpers such as `LayoutProps` and `RouteContext` |
| `pnpm lint` | `eslint .` (flat config; Next 16 removed `next lint`). Also enforces import boundaries |
| `pnpm test` | Vitest, no network |
| `pnpm eval [--set deals,towns] [--baseline]` | Gold-set accuracy and cost report (costs money) |
| `pnpm eval:lists` | Grades open-ended list fields (costs money) |
| `docker compose up` | Whole stack: app, worker, MongoDB, Redis. Needs `.env` with `GEMINI_API_KEY` |

## Code conventions

- File and folder names: short **kebab-case**, **max 2 hyphens** (`job-progress.tsx`, not `job-progress-status-bar-view.tsx`). Next.js reserved files keep their names (`page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`…).
- TypeScript `strict`. **No `any`.**
- **Named exports only**, except where Next.js requires a default export. Components are PascalCase exports in kebab-case files.
- **Zod at every boundary**: request bodies, route params, queue payloads, env, LLM output. Types come from `z.infer<typeof Schema>`, never written by hand twice.
- Env vars are read only through the Zod-validated env modules (`src/lib/env.ts`, `engine/config/env.ts`).
- App: Server Components by default; `"use client"` only on small leaf components. One component per file; split past ~150 lines.
- App server-only modules start with `import "server-only"`. **Never in `engine/`**: the worker runs in plain Node, where it throws.
- API errors are uniform: `{ error: { code, message } }` with the right HTTP status. Routes validate, then rate-limit, then work.
- Model names come from env, one per role. Never hard-code them; use `modelFor(role)` / `chatModel(role)` / `genAIModel(role)`.
- shadcn/ui uses the `base-nova` preset (Base UI primitives) and `cn` from `@/lib/utils`. Add components with `pnpm dlx shadcn@latest add <name>`.

## Folder structure

```
engine/                 # the worker; plain Node, no Next.js
├── index.ts            # boot, start workers, graceful shutdown
├── config/             # env.ts (lazy getters), limits.ts, load-env.ts
├── contracts/          # shared Zod schemas: job-config, job-status, row-result, columns, queue-names
├── core/               # pure pipeline logic (no DB, no queue):
│                       #   enrich-row (orchestrates), research, search, build-prompt, source-tier,
│                       #   entity-article, anchors, wikidata, page, read-pages, page-text, pdf-text,
│                       #   extract, build-schema, evidence, verify, cost, dedupe, csv,
│                       #   suggest, source-plan, site-check, scope
├── llm/                # gemini.ts (grounded search client), models.ts (MODEL_CATALOG, roles, fallbacks)
├── db/                 # client.ts (+ ensureIndexes), jobs.ts, rows.ts
├── queue/              # connection.ts, queues.ts, workers.ts
├── processors/         # prepare.ts, enrich.ts, finalize.ts
├── utils/              # logger.ts (pino), errors.ts (isTransient), lazy.ts
└── eval/               # gold-*.csv, gold-sets.ts, run-eval.ts, score.ts, baseline.ts, list-judge.ts, run-lists.ts
src/                    # the Next.js app
├── app/                # page.tsx (wizard), jobs/[id]/, api/suggest, api/jobs (+ [id], rows, download, retry)
├── components/         # ui/ (shadcn), wizard/, fields/, job/
├── hooks/              # use-job.ts, use-rows.ts (polling)
├── instrumentation.ts  # assertEnv() at server boot
└── lib/                # env, api (schemas), http, queue, redis, rate-limit, csv, views, comments, format…
```

## Import boundaries (enforced by ESLint)

Path aliases: `@/*` → `./src/*`, `@engine/*` → `./engine/*`.

- `engine/core/` imports **only** `engine/contracts`, `engine/config`, `engine/llm`, `engine/utils`. No `mongodb`, `bullmq` or `ioredis`.
- `engine/processors/` may import anything in the engine.
- The engine never imports from `src/` or `server-only`.
- The app imports **only** `@engine/contracts/*`, `@engine/db/*`, `@engine/core/suggest` and `@engine/core/csv`, always through the `@engine/*` alias.
- The app makes **no LLM calls** except `/api/suggest` → `suggestSetup()`. It never imports `@google/genai` or `@langchain/*`.

## How a job runs

1. **Upload** (wizard): CSV up to `MAX_CSV_ROWS` = 500 rows / `MAX_CSV_BYTES` = 1 MB, parsed in the browser.
2. **Suggest** (`POST /api/suggest` → `core/suggest.ts`): proposes the key column, entity description, fields and source plan. See "Suggest" below.
3. **Preview** (`POST /api/jobs`, `mode: "preview"`): the first `ROW_CAPS.preview` = 5 rows. The wizard's last step shows it as "Estimate the total cost": preview `costUsd / (done + failed)` × the full run's rows. "Run the full job" is disabled until the preview completes.
4. **Full run** (`mode: "full"`): up to `ROW_CAPS.full` = 25 rows (the demo cap). The email field is optional and only stored on the job.
5. **Worker**: `prepare` creates the rows, dedupes keys and enqueues one `enrich` job per unique row. `enrich` runs `enrichRow`, saves the row and counts it. After the last row, `finalize` copies results to duplicate rows (no extra cost) and marks the job completed.
6. **Results**: the job page polls status and rows, shows a results table (quotes and blank reasons in tooltips), and offers the CSV download and a retry of failed rows.

## Design decisions

### Env
- One shared `.env`; `.env.example` lists every app and engine variable. Docker Compose overrides `MONGODB_URI` and `REDIS_URL` with its own services.
- `engine/config/env.ts` exposes lazy, per-section getters, so importing the engine never parses env.
- `src/lib/env.ts` validates the 4 app vars (`MONGODB_URI`, `REDIS_URL`, `GEMINI_API_KEY`, `APP_URL`) on first use, and `src/instrumentation.ts` calls `assertEnv()` so the server fails fast at boot while `next build` needs no secrets. `DEFAULT_MINUTES_PER_FIELD` (default 0.5) and `APP_URL` for metadata are parsed separately so pages build without secrets.
- Standalone entry points (worker, evals) call `loadEnvFiles()` from `engine/config/load-env.ts`. The app must never import that file: its `fs` use makes Next trace the whole project.

### Jobs and queues
- **Counting is atomic and idempotent**: filter `{ _id: jobId, countedRows: { $ne: rowId } }`, then `$inc` done/failed/costUsd and `$push` the row id. The enrich guard sends rows already saved (status ≠ pending) straight to the count step, so a crash between save and count re-runs safely. No reconcile step; safe with multiple workers. `countedRows` is never exposed by the API.
- **BullMQ job ids** are `${jobId}-${rowId}` (BullMQ 6 rejects `:`). Retry rounds append `-r${retries}`, prepare too, since BullMQ ignores ids it still holds.
- **Retries**: enrich jobs get 5 attempts with exponential backoff from 10 s, to ride out Gemini 503 spikes. Rows that still fail can be retried from the job page: `POST /api/jobs/[id]/retry` (completed jobs only) reopens the job (`reopenJob`: running, `failed −= n`, rows pulled from `countedRows`, `retries += 1`), resets those rows to pending with zero cost and enqueues prepare again. Rows with an empty key are never retried. The job's `costUsd` keeps what failed attempts spent; the retry's cost is added on top.
- **Preview reuse**: the full run sends `previewJobId`. `POST /api/jobs` keeps it only if that job is a completed preview with the same first-5-rows CSV and the same config. Prepare then copies each `done` preview row (same index and key) into the full job as done and counted at start, so it isn't researched again. Failed preview rows are researched again. The full job's `costUsd` includes the reused rows' cost.

### Gemini
- Grounded search: `@google/genai` with the `googleSearch` tool (`engine/llm/gemini.ts`). Search calls = `webSearchQueries.length` (Gemini 3+ bills per query). Citations are redirect links that `search.ts` resolves to real URLs.
- Extraction and verification: LangChain `ChatGoogleGenerativeAI.withStructuredOutput(..., { method: "jsonSchema", includeRaw: true })`. LangChain's `output_tokens` excludes thinking tokens, so output is `total_tokens − input_tokens`. Gemini's response schema rejects JSON Schema type arrays; `toModelJsonSchema` rewrites them as `nullable`.
- **Model roles** (`engine/llm/models.ts`): strong models where judgement matters, cheap ones for copying. Defaults are in `.env.example`: search (thinking low), extract (minimal), verify (medium), rescue = `MODEL_VERIFY` at low for the last extraction retry, suggest (low; the user waits on it), judge for evals (medium). Each role names a wanted thinking level; if the model lacks it, the nearest level above is used. Thinking is sent only when it differs from the model's default.
- `MODEL_CATALOG` holds each model's price, dated price changes and thinking levels. Gemini 3+ only (2.5 bills grounding per prompt, not per query).
- **503 fallbacks**: `MODEL_<ROLE>_FALLBACKS` is a comma list; `withFallback()` tries the next model at once on a 503 (SDK retries only on the last). Judge has none. There is no per-call timeout, because Google may still bill a cancelled grounded search's queries.
- Typical cost: about $0.02–0.04 per row, most of it the grounded search queries.

### Fields and suggest
- **Field types**: text, number, year, url, enum, list, boolean. `core/build-schema.ts` turns them into the extraction JSON schema.
- **Fields may reuse CSV columns** (except the key column). A field name is any CSV header as written (no `.` or leading `$`); new fields are snake_case. Only blank cells are filled; the user's non-blank values are always kept (`mergedOutput` in `src/lib/views.ts`), and reused columns stay in place in the export.
- **Suggest** makes two calls. The setup call (fields, roles, scope column) sees `ColumnSummary`s of every column over the whole file. If the file has mostly-empty columns (blank in ≥ half the sample rows, any header style, first 15), those become exactly the fields, named as the headers, with no new ones added; only a file with no empty columns gets 4–8 new fields. The sites call proposes ≤8 sites for all rows and ≤4 per scope value for the `MAX_SCOPES` = 30 most common values, never the rows' own sites or Wikipedia/Wikidata.
- **Source plan** (`core/source-plan.ts`, `core/site-check.ts`, `core/scope.ts`; editable in the wizard's "Where to look"): each field has `roles`, the kinds of source that publish it, best first (`own` = the entity's or maker's pages, `registry` = who regulates, certifies or records it, `reference`, `listing`), plus `source` (kinds of page, ≤150 chars). The job has an optional `scopeColumn` (the column that changes which sources are right: country, platform, region, edition…) and `sites` (host, role, `scope` = one scope value or null for all rows, `status`). Each suggested site's homepage is fetched once: `readable` (≥300 chars of text), `search_only` (blocked, login, script-rendered) or dead (dropped). Hand-added sites are `unchecked`.

### Accuracy pipeline (`core/enrich-row.ts`)

research → entity article → anchors → read pages → extract → quote check → verify.

- **Research** (`core/research.ts`, `core/build-prompt.ts`): with 2+ list fields each list gets its own search; other fields share (≤ `FIELDS_PER_SEARCH` = 10). At most `MAX_SEARCHES_PER_ROW` = 2 searches per row (round-robin merge), each told to run ≤ `MAX_QUERIES_PER_SEARCH` = 2 queries (queries are most of the cost). A search with nothing grounded is retried once (`SEARCH_RETRY`). Prompts carry today's date, source-priority, recency, identity and conflict rules, the role definitions, each field's source chain and the row's scope sites ("aim your queries at them, e.g. site:"). Prompts state general rules, not domain lists; `VERSION_RULE` picks the version (region, currency, edition…) most people in the row's market would mean.
- **Grounded notes only** (`core/search.ts`): notes are built from Gemini `groundingSupports`; text without a citation is dropped. Sources are ranked by tier (`core/source-tier.ts`: official > authority > reference > web > community; reference = Wikipedia, Wikidata and the plan's non-registry sites; the plan's registries rank as authority), capped at `MAX_SOURCES` = 8 per search and `MAX_ROW_SOURCES` = 16 per row. Claims backed only by dropped sources are dropped.
- **Entity article** (`core/entity-article.ts`, no LLM): the row's Wikipedia article, cited or looked up by name (only when the row has something to check it against). Accepted only if it agrees with the row: when the entity's own site is known (row URL, or a cited source named after the key) the article must link to it; otherwise it must contain the row's own values. It feeds Wikidata and is read as a page. Other Wikipedia articles are never read.
- **Anchors** (`core/anchors.ts`, `core/wikidata.ts`, `core/page.ts`; no LLM; only when the job has a URL field): facts a search can't state as a sentence. Wikidata link statements (official site, LinkedIn, X, Instagram, Facebook, YouTube) for the checked article's entity, main value per property only. The official site is the first candidate (row URL, Wikidata, sources named after the key, sites a claim names) whose homepage loads and names the key; its own profile links override Wikidata's. These become page claims (`origin: "page"`). Anchors never fail the row.
- **Read pages** (`core/read-pages.ts`, `core/page-text.ts`, `core/pdf-text.ts`; no LLM): up to `MAX_PAGES_PER_ROW` = 4 pages: the checked article (added as a source if uncited), the entity's own pages, the plan's readable sites for the row (registries first), then authority/reference pages. `search_only` sites, Wikidata and other Wikipedia articles are skipped. At most 1 PDF per row (`unpdf`, first 120 pages, ≤30 MB, 20 s). Page text becomes page claims: infobox rows as "Label: value", the opening passages and passages mentioning the fields' terms, ≤ `MAX_PAGE_CHARS` = 8000 per page.
- **Extract** (`core/extract.ts`): returns `{ value, quotes }` per field (per item for lists): one quote for a plain fact, up to `MAX_QUOTES_PER_VALUE` = 3 for a value written from several claims. Values are validated against the schema and retried with the errors fed back; the last retry uses the rescue model.
- **Quote check** (`core/evidence.ts`, no LLM): each quote must be copied from a grounded claim. Quotes found in no claim are dropped (≥1 must match); the rest are stored joined with " … ". Years must appear in the quote; a URL must be one of the claim's sources or a page above one, or appear in full in a page claim (a URL only in the search model's wording is rejected). Sources come from the claim, never the model. Matching ignores case, spacing, markdown, quote marks, dashes and digit grouping (383,853 = 383853). Failure → `unsupported`.
- **Verify** (`core/verify.ts`, one call): judges each value or list item against its quotes and the field definition (right entity, scope, current state). Rewording or combining the quotes is fine; any detail they don't state is not. Verdicts must cover every id (partial lists are retried). Not supported → `rejected`.
- Each stored quote has `origin`: `page` (text we read) or `search` (some part is the search model's wording). Search-only values are marked "(search summary)" in `_evidence` and the tooltip, and named in `_comments`.
- Every value dropped by the checks or verify is kept on the row as `rejected` (value, quotes, reason) for debugging. It is never returned by the API or exported.
- Known limits: a quote proves traceability to a grounded claim, not that the page says it today (stale sources can pass). Strict checks drop some correct values.

### Output
- Rows store `evidence` per cell: quotes with source numbers, or `blank`: `not_found` | `unsupported` | `rejected`. The API returns evidence for researched cells only.
- **CSV export** (`resultCsv` in `src/lib/views.ts`), column order: the original headers (reused fields filled in place), new fields, `_sources` (`[1] url; [2] url`), `_evidence` (one line per researched field: quotes with source numbers, or the blank reason), `_status` (`done` or `failed: <reason>`), `_cost_usd`, `_comments` (`src/lib/comments.ts`: plain-words explanation of blank cells and search-summary values; no LLM).

### Rate limits and caps
- Per-IP limits backed by Redis (`src/lib/rate-limit.ts`): suggest 10/min, create job 5/min, retry 5/min, reads 120/min (polling runs every 2 s per open tab).
- `ROW_CAPS` (`engine/contracts/job-status.ts`): preview 5, full 25. There are no accounts or auth.

## Evals
- Six gold sets in `engine/eval/gold-sets.ts`: companies, cities, books, plus harder deals, licenses and towns with recency and null traps (web-verified Oct 2026). The headline metric is the false-value rate (wrong cells among filled cells); `--baseline` compares against a plain LLM.
- `pnpm eval:lists` grades open-ended list fields (Business Model Canvas on 5 companies) with a separate strict grounded fact-check (`engine/eval/list-judge.ts`).
- To compare against older engine code, swap in its `engine/core` files from git and rerun.
- Never edit gold answers without re-verifying them on the web, and leave out facts whose sources disagree.
