# Life Hub

A small, private dashboard that pulls my day into one screen: today's calendar, my TickTick "Today" list, quick add to "Next", weekly habit percentages, and a Restart button for getting back on track after time away.

Built as a portfolio project to practice secure OAuth integrations, edge deployment and AI-assisted development with guardrails.

## How it works

- **One Cloudflare Worker** serves the page and the API. No scheduled jobs.
- **Reads, never stores.** TickTick and Google Calendar stay the source of truth. The only stored data is encrypted OAuth tokens.
- **Locked down.** Cloudflare Access in front, plus JWT validation inside the Worker. POST-only for anything that changes data.

## Security practices

- No secrets in the repo: Worker secrets, a gitleaks pre-commit hook and GitHub push protection.
- CI on every pull request: typecheck, tests, gitleaks and a production dependency audit. Dependabot and CodeQL run from GitHub's security settings.
- Claude Code runs sandboxed, with deny rules on secret and credential files and approval required for pushes, deploys and package installs.
- Independent security review by a fresh-context agent before merge.

## Run it locally

```
npm install
cp .dev.vars.example .dev.vars   # fake data, Access skipped on localhost only
npm run dev                      # http://localhost:8787
npm test
npm run typecheck
```

## Status

🚧 v1 in progress. See [`docs/design/v1.md`](docs/design/v1.md).
