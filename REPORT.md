# REPORT: TokenGuard MVP

Date: 2026-10-30. Nothing was pushed, deployed, bought or sent. No subagents used.

## Status

| Check | Result |
|---|---|
| `npm install && npm run build` | Green (Next 15; `/`, 5 API routes) |
| `scripts/hard-stop.js` against `next start` | All 6 checks true; wrote `docs/sample-hard-stop.json` |
| `/v1/chat/completions` rewrite, missing-budget 400, `/api/health`, hosted `/api/mcp` (`draft_slack_chargeback`, `check_allow` unknown budget) | Ran, correct |
| Stdio MCP | initialize, tools/list, `set_budget`, `check_allow` worked over stdin |
| Secrets | grep for `sk-…` patterns: none. `.env.example` has no values |
| Colours in `app/` | Only `#b83a07 #0e1b1d #eeebe3` (plus rgba of ink/paper/orange) |

## Proof (`docs/sample-hard-stop.json`)

Demo mode, $0.02 limit, `max_tokens: 64`. Soft alert crossed on call 6 (spend $0.01632 = 81.6%), calls 7–9 returned 429 `projected_cost_exceeds_remaining`, spend did not move. Server-side `blockedCalls` matched.

An earlier run **without** `max_tokens` ended at $0.0218 (108.8% of limit): the crossing call overshot. That is inherent without a known output cap, so the README documents it and the proof script sends `max_tokens`.

## Not verified / not done

- **Pass-through mode was not exercised against any real upstream** (no key, no network use). The code path is written but untested. Treat it as unverified.
- **UI was not opened in a browser.** It compiles and the API it calls was tested; I did not screenshot or click through it.
- **Evidence claims**: Gemini Enterprise token budgets, Databricks Unity AI Gateway, Speakeasy come from the brief. Web search was denied in this session, so I did not open them. The page and README name them with no figures and say they are unverified. Add URLs before launch.
- Dodo ids come from the brief, not checked against Dodo.
- Demo prices are placeholders, not vendor prices.
- Paid tiers are not built (no persistence service, no auth). Pricing copy says so.
- Admin routes (`/api/budget`) are unauthenticated; state is in-memory per instance. No streaming support.
