# Contributing to Rowsmith

Thanks for your interest in improving Rowsmith. Bug reports, fixes, docs and features are all welcome.

## Before you start

- **Bugs:** open an issue with steps to reproduce, what you expected and what happened. Include the CSV headers and field setup if the problem is with a job (leave out private data).
- **Features and larger changes:** open an issue first so we can agree on the approach before you write the code.
- **Security issues:** don't open a public issue. Follow [SECURITY.md](SECURITY.md).

## Development setup

1. Install Node.js 22+ and pnpm 9 (`corepack enable`). Use **pnpm** only.
2. Start MongoDB and Redis:
   ```bash
   docker run -d --name rowsmith-mongo -p 27017:27017 mongo:8
   docker run -d --name rowsmith-redis -p 6379:6379 redis:7
   ```
3. Copy the env file and set `GEMINI_API_KEY`:
   ```bash
   cp .env.example .env
   ```
4. Install and run the app and the worker in two terminals:
   ```bash
   pnpm install
   pnpm dev
   pnpm worker:dev
   ```

`pnpm test` needs no network or API key. `pnpm eval` and `pnpm eval:lists` call the real Gemini APIs and cost money.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep each PR focused on one change. Add or update tests for behaviour you change.
3. Before you push, make sure these pass:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```
4. If your change affects accuracy (prompts, extraction, checks, verify), say how you tested it. Results from `pnpm eval` on a gold set help reviewers, but they cost money to run, so they aren't required.
5. Describe what changed and why in the PR.

## Code conventions

The full rules and design decisions are in [CLAUDE.md](CLAUDE.md). The short version:

- TypeScript `strict`, **no `any`**.
- File and folder names are short kebab-case with at most 2 hyphens (`job-progress.tsx`).
- **Named exports only**, except where Next.js requires a default export (pages, layouts).
- **Zod at every boundary** (request bodies, route params, queue payloads, env, LLM output). Types come from `z.infer`, never duplicated by hand.
- Env vars are read only through `src/lib/env.ts` and `engine/config/env.ts`.
- Server Components by default; `"use client"` only on small leaf components.
- Model names come from env through `modelFor(role)`, never hard-coded.
- Model prices live in `MODEL_CATALOG` (`engine/llm/models.ts`) and must be copied from Google's pricing page with its "last updated" date.
- Import boundaries are enforced by ESLint: `engine/core/` stays pure, and the app (`src/`) imports only `@engine/contracts/*`, `@engine/db/*`, `@engine/core/suggest` and `@engine/core/csv`.
- The guiding accuracy rule: a cell is filled only if a cited source states it. Changes that fill more cells by loosening this rule won't be accepted.

## License

By contributing, you agree that your contributions are licensed under the [GNU Affero General Public License v3.0](LICENSE), the same license as the project.
