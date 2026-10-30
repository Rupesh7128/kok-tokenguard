/**
 * The circuit breaker. One entry point: handleChat({ headers, body }) -> { status, headers, json }.
 *
 * Mode is chosen by the caller, and labelled in every response:
 *   - "demo"        no Authorization header: mock upstream, deterministic simulated token counts.
 *   - "passthrough" Authorization header present: forwarded to OPENAI_BASE_URL with the caller's own key.
 * The caller's key is used for that single request only. It is never stored, echoed or logged.
 */
import { checkAllow, estimateTokens, messagesText, recordBlocked, recordUsage, getBudget, view } from "./budget.js";

export const BUDGET_HEADER = "x-tokenguard-budget";
const UPSTREAM_TIMEOUT_MS = 60_000;

const err = (status, code, message, extra = {}, headers = {}) => ({ status, headers, json: { error: { type: code === "tokenguard_hard_stop" ? "budget_exceeded" : "invalid_request_error", code, message, ...extra } } });

const guardHeaders = (mode, v, extra = {}) => ({
  "x-tokenguard-mode": mode,
  "x-tokenguard-state": v.state,
  "x-tokenguard-spent-usd": String(v.spentUsd),
  "x-tokenguard-remaining-usd": String(v.remainingUsd),
  "x-tokenguard-soft-alert": String(v.softAlert),
  ...extra,
});

/** Deterministic mock upstream: same prompt in, same tokens out. No randomness, no network. */
export function mockUpstream(body) {
  const inputTokens = estimateTokens(messagesText(body.messages));
  const users = (body.messages || []).filter((m) => m?.role === "user");
  const last = String(users.at(-1)?.content ?? "").replace(/\s+/g, " ").trim();
  const wanted = Math.ceil(inputTokens * 0.6) + 24;
  const cap = Number.isFinite(+body.max_tokens) && +body.max_tokens > 0 ? Math.floor(+body.max_tokens) : Infinity;
  const outputTokens = Math.min(wanted, cap);
  const text = `[TokenGuard demo upstream] You said: "${last.slice(0, 160)}${last.length > 160 ? "…" : ""}"`;
  return { text, usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens } };
}

export async function handleChat({ headers, body }) {
  const get = (k) => headers.get?.(k) ?? headers[k] ?? null;
  const budgetId = get(BUDGET_HEADER);
  if (!budgetId) return err(400, "missing_budget", `Send a ${BUDGET_HEADER} header naming the budget to charge.`);
  if (!body || typeof body !== "object" || !Array.isArray(body.messages) || body.messages.length === 0) return err(400, "invalid_body", "Body must be JSON with a non-empty messages array.");
  if (body.stream) return err(400, "stream_unsupported", "TokenGuard MVP does not proxy streaming. Send stream:false.");

  const b = getBudget(budgetId);
  if (!b) return err(404, "unknown_budget", `No budget "${String(budgetId).slice(0, 40)}". Create one with POST /api/budget.`);

  const auth = get("authorization");
  const mode = auth ? "passthrough" : "demo";
  const model = typeof body.model === "string" && body.model ? body.model.slice(0, 80) : mode === "demo" ? "tokenguard-demo" : "default";
  const estIn = estimateTokens(messagesText(body.messages));
  const maxOut = Number.isFinite(+body.max_tokens) && +body.max_tokens > 0 ? Math.floor(+body.max_tokens) : 0;

  // Hard stop. Checked BEFORE any upstream call, so a tripped breaker costs nothing.
  const gate = checkAllow(budgetId, { model, inputTokens: estIn, maxOutputTokens: maxOut });
  if (!gate.allow) {
    recordBlocked(budgetId, { mode, model, reason: gate.reason, projectedCostUsd: gate.projectedCostUsd });
    const v = view(getBudget(budgetId));
    return {
      status: 429,
      headers: guardHeaders(mode, v, { "x-tokenguard-hard-stop": "true" }),
      json: {
        error: {
          type: "budget_exceeded",
          code: "tokenguard_hard_stop",
          message:
            gate.reason === "budget_exhausted"
              ? `Budget "${v.id}" is exhausted ($${v.spentUsd} of $${v.limitUsd}). Request not sent upstream.`
              : `This call could cost up to $${gate.projectedCostUsd} but only $${v.remainingUsd} remains in budget "${v.id}". Request not sent upstream.`,
          reason: gate.reason,
          mode,
          budget: v,
          projectedCostUsd: gate.projectedCostUsd,
        },
      },
    };
  }

  let completion;
  let usage;
  let estimated = false;

  if (mode === "demo") {
    const m = mockUpstream(body);
    usage = { input: m.usage.prompt_tokens, output: m.usage.completion_tokens };
    estimated = true; // simulated, derived from prompt length
    completion = {
      id: `chatcmpl-tg-demo-${Date.now().toString(36)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content: m.text }, finish_reason: "stop" }],
      usage: m.usage,
    };
  } else {
    const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    let res;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({ ...body, stream: false }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      return err(502, "upstream_unreachable", `Upstream request failed (${e.name}). Nothing was charged.`);
    }
    let up;
    try {
      up = await res.json();
    } catch {
      return err(502, "upstream_bad_response", `Upstream returned HTTP ${res.status} with a non-JSON body. Nothing was charged.`);
    }
    if (!res.ok) return { status: res.status, headers: guardHeaders(mode, view(getBudget(budgetId)), { "x-tokenguard-charged": "false" }), json: up };
    const pt = Number(up?.usage?.prompt_tokens);
    const ct = Number(up?.usage?.completion_tokens);
    if (Number.isFinite(pt) && Number.isFinite(ct)) usage = { input: pt, output: ct };
    else {
      estimated = true;
      usage = { input: estIn, output: estimateTokens((up?.choices || []).map((c) => c?.message?.content ?? "").join("\n")) };
    }
    completion = up;
  }

  const rec = recordUsage(budgetId, { model, input: usage.input, output: usage.output, estimated, mode });
  const v = rec.budget;
  completion.tokenguard = {
    mode,
    modeLabel: mode === "demo" ? "DEMO: mock upstream, simulated token counts" : "PASS-THROUGH: real upstream, usage from upstream or chars/4 estimate",
    tokens: { input: usage.input, output: usage.output, estimated },
    costUsd: rec.costUsd,
    priceModel: model,
    softAlert: v.softAlert,
    crossedSoftThisCall: rec.crossedSoft,
    hardStopNext: v.hardStop,
    budget: v,
  };
  return { status: 200, headers: guardHeaders(mode, v), json: completion };
}
