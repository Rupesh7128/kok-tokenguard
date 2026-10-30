# TokenGuard: a circuit breaker for LLM spend

By [Kingdom of Kumar Lab](https://www.kingdomofkumar.com) · Mayank Raj · MIT

A small proxy that sits in front of an OpenAI-compatible `chat/completions` API. It keeps a per-agent budget in tokens and USD, flags a **soft alert at 80%** (configurable) and **hard-stops at 100%** with HTTP 429 before the request reaches the upstream.

## Modes (read this first)

Every response says which mode ran (`tokenguard.mode`, header `x-tokenguard-mode`).

| Mode | Trigger | What happens | Token numbers |
|---|---|---|---|
| **demo** (free) | No `Authorization` header | **No model is called.** A mock upstream echoes the last user message. | **Simulated and deterministic**: input = chars/4 of all messages; output = `ceil(0.6 × input) + 24`, capped by `max_tokens`. Same prompt, same numbers. |
| **passthrough** | `Authorization: Bearer …` present | Forwarded to `OPENAI_BASE_URL` (default `https://api.openai.com/v1`) with the caller's key. | From the upstream `usage` field; **chars/4 estimate** if it is missing (flagged `estimated: true`). |

The accounting, soft alert and 429 are the same code in both modes. The demo prices are placeholders (`tokenguard-demo`: $20 / $60 per 1M in/out), picked so a small budget visibly drains. They are **not** any vendor's price list. Set `TOKENGUARD_PRICES` for real models; an unknown model falls back to `default`.

Keys: the caller's key is used for that one request and is never stored, echoed or logged (the code never logs request headers). `.env.example` holds no secrets.

## Run

```bash
npm install
npm run dev                     # http://localhost:3000
npm run build && npm start
```

Node 22+. Create a budget, then call the proxy:

```bash
curl -s localhost:3000/api/budget -H 'content-type: application/json' \
  -d '{"id":"support-agent","limitUsd":0.05,"softPct":0.8}'

curl -s localhost:3000/v1/chat/completions \
  -H 'content-type: application/json' -H 'x-tokenguard-budget: support-agent' \
  -d '{"model":"tokenguard-demo","max_tokens":64,"messages":[{"role":"user","content":"hello"}]}'
```

`/v1/chat/completions` is a rewrite of `/api/v1/chat/completions`, so an OpenAI client can use `http://host:3000/v1` as its base URL plus the `x-tokenguard-budget` header.

## How the breaker decides

1. **Pre-flight, before any upstream call.** Blocked if spend ≥ limit (`budget_exhausted`), or if spend + projected cost > limit (`projected_cost_exceeds_remaining`). Projected cost = estimated input tokens + `max_tokens` (if the caller sends it) at the model's price.
2. **Account** actual or estimated tokens, add USD from the price table.
3. **Soft alert** once spend ≥ `softPct × limit`: `softAlert: true` in the body, `x-tokenguard-soft-alert: true`, and `crossedSoftThisCall` on the call that crossed it.
4. **Hard stop** returns 429:

```json
{ "error": { "type": "budget_exceeded", "code": "tokenguard_hard_stop", "reason": "budget_exhausted",
  "message": "Budget \"x\" is exhausted ($0.0218 of $0.02). Request not sent upstream.",
  "mode": "demo", "budget": { "state": "tripped", "spentUsd": 0.0218, "limitUsd": 0.02, "..." : "..." } } }
```

**Overshoot caveat.** If a caller omits `max_tokens`, the output size is unknown before the call, so the call that crosses the limit is allowed and can overshoot it (we saw 108.8% of a $0.02 budget in one run). Send `max_tokens` to get the strict guarantee. With it, the pre-flight is a worst-case check and spend stays at or under the limit as long as the upstream honours `max_tokens`.

Not supported in the MVP: streaming (`stream:true` returns 400 `stream_unsupported`), tool-call/multimodal token accounting beyond JSON-stringified content, auth on the admin routes.

## API

| Route | |
|---|---|
| `POST /v1/chat/completions` (`/api/v1/...`) | The proxy. Header `x-tokenguard-budget` required. |
| `POST /api/budget` | Create/update `{id, limitUsd, softPct?, reset?}`. `GET` lists or `?id=`; `DELETE ?id=`. |
| `GET /api/usage?id=` | Budget view + last 50 events. |
| `POST /api/mcp` | Hosted MCP (JSON-RPC 2.0, tools only). |
| `GET /api/health` | Status, modes, known models. |

**State is in process memory** (shared by all visitors of an instance; on serverless it resets on cold start). `/api/budget` has no auth in this MVP, so do not expose it to the internet as-is. Set `TOKENGUARD_STATE_FILE` to persist to a JSON file on a machine you control.

## MCP tools

`set_budget`, `get_usage`, `check_allow` (would this call be allowed? no call made), `draft_slack_chargeback` (drafts Slack text from recorded usage; sends nothing).

```json
{ "mcpServers": { "kok-tokenguard": {
  "command": "node", "args": ["/absolute/path/to/tokenguard/mcp/server.js"],
  "env": { "TOKENGUARD_STATE_FILE": "/tmp/tokenguard.json" } } } }
```

The stdio server holds its own state; it shares budgets with the HTTP proxy only if both run on one machine and use the same `TOKENGUARD_STATE_FILE` (and note the proxy reads the file once at start-up).

## Proof of the hard stop

```bash
npm run build && npm start &
node scripts/hard-stop.js       # writes docs/sample-hard-stop.json
```

`docs/sample-hard-stop.json` is untouched output from a real run against the HTTP server in demo mode: $0.02 budget, 6 successful calls, soft alert on call 6, calls 7–9 blocked with 429, spend frozen at $0.01632. The script exits non-zero if any check fails.

## Why this exists: prior art (not re-verified)

Per-agent token/spend limits at a gateway are an idea other vendors ship or write about. We name them as context and quote **no figures**; we did not open their pages for this build (web search was unavailable), so check the current docs yourself:

- Google Gemini Enterprise: token budgets for agent usage.
- Databricks Unity AI Gateway: governance and limits in front of model endpoints.
- Speakeasy: writing on gateway-style controls for LLM and MCP traffic.

## Pricing

Free (demo or your own key) · **$29/mo** Team (`pdt_0NqsRJYNh5L3tuuyENDEq`) · **$79/mo** Platform (`pdt_0NqsRJebjhEGwpM93aKOL`). The paid tiers (hosted persistent budgets, history, many budgets) are **not built**; the UI says so. Checkout links come from `NEXT_PUBLIC_DODO_CHECKOUT_URL_29/79`, else an email link.
