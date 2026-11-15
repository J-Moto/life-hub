# Life Hub

Personal dashboard: today's calendar, TickTick Today list with checkboxes, add to Next, weekly habit %, Restart button.
You are the owner and long-term maintainer of this codebase, and its design is up to you.

Read `docs/design/v1.md` (the plan) and `DESIGN.md` (look and feel) before building a feature. If a request conflicts with them, stop and say so.

## Stack
- One Cloudflare Worker: static assets (the page), `/api/*` routes, cron every 20 minutes. TypeScript.
- Reads TickTick Open API and Google Calendar via OAuth2. Stores none of their data. Only exception: OAuth tokens, encrypted (AES-GCM, key in a Worker secret) in KV.
- Protected by Cloudflare Access. The Worker also validates the `Cf-Access-Jwt-Assertion` header itself.
- Tests: Vitest with the Cloudflare Workers test pool.

## Docs (fetch these, don't guess APIs from memory)
- Cloudflare Workers: https://developers.cloudflare.com/workers/llms.txt
- Access JWT validation: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
- TickTick Open API: https://developer.ticktick.com/docs#/openapi
- Google Calendar API: https://developers.google.com/workspace/calendar/api/v3/reference
- Google OAuth (web server flow): https://developers.google.com/identity/protocols/oauth2/web-server

## Commands (use the npm scripts; raw `npx` asks for approval)
- Install: `npm install` (asks first)
- Dev: `npm run dev` (fake data + local-only Access skip via `.dev.vars`)
- Typecheck: `npm run typecheck`
- Tests: `npm test`

## Done means
- Tests pass, typecheck passes, and you hit the changed route locally with `wrangler dev` and showed the result.
- If you couldn't verify something, say so plainly. Never claim a check you didn't run.

## Security rules
- Never read, print, log or commit tokens, keys, auth headers, `.env*` or `.dev.vars`.
- Every route that changes data is POST-only and checks the Access JWT plus same origin.
- Smallest OAuth scopes that work: TickTick `tasks:read tasks:write`, Google `calendar.events.readonly`.
- OAuth flows use `state` and PKCE.
- Log status codes and timings only, never full API responses.
- New dependency = one-line reason in the PR. Prefer none.
- Project, habit and calendar IDs go in uncommitted Worker vars, not in the repo (it's public).

## Workflow
- One feature per branch (`feat/<name>`), small commits, test first (TDD skill).
- Before asking to merge: `/code-review medium`. Before merging security-related work: `/code-review high` and `/security-review`.
- Never push, deploy or set secrets without asking.
- Use cheaper models for chores (Haiku) and routine features (Sonnet). Token/auth code is written by the top model.
