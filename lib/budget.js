/**
 * Budget engine. Pure accounting: tokens in/out, USD from a price table, soft alert, hard stop.
 * State is in process memory (globalThis, so Next dev reloads keep it). Set TOKENGUARD_STATE_FILE to persist to disk.
 */
import fs from "node:fs";

export const DEFAULT_PRICES = {
  // USD per 1M tokens. DEMO figures, chosen so a small budget visibly depletes. Not any vendor's price list.
  // Override with TOKENGUARD_PRICES for real models.
  "tokenguard-demo": { input: 20, output: 60 },
  default: { input: 5, output: 15 },
};

export function priceTable() {
  let extra = {};
  try {
    if (process.env.TOKENGUARD_PRICES) extra = JSON.parse(process.env.TOKENGUARD_PRICES);
  } catch {
    /* bad JSON: fall back to defaults */
  }
  const t = { ...DEFAULT_PRICES };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && Number.isFinite(+v.input) && Number.isFinite(+v.output) && +v.input >= 0 && +v.output >= 0) t[k] = { input: +v.input, output: +v.output };
  }
  return t;
}

export function priceFor(model) {
  const t = priceTable();
  return { ...(t[model] || t.default), matched: t[model] ? model : "default" };
}

/** chars/4, the usual rough rule. Used whenever the upstream omits usage. */
export const estimateTokens = (text) => Math.ceil(String(text ?? "").length / 4);

export function messagesText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "")))
    .join("\n");
}

export const costUsd = (model, inTok, outTok) => {
  const p = priceFor(model);
  return (inTok * p.input + outTok * p.output) / 1e6;
};

const MAX_BUDGETS = 200;
const MAX_EVENTS = 100;
const store = (globalThis.__tokenguard ??= { budgets: new Map(), loaded: false });
const FILE = () => process.env.TOKENGUARD_STATE_FILE;

function load() {
  if (store.loaded || !FILE()) return;
  store.loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    for (const b of raw.budgets || []) store.budgets.set(b.id, b);
  } catch {
    /* no state yet */
  }
}
function save() {
  if (!FILE()) return;
  try {
    fs.writeFileSync(FILE(), JSON.stringify({ budgets: [...store.budgets.values()] }));
  } catch {
    /* read-only fs: stay in memory */
  }
}

const round = (n, d = 8) => Math.round(n * 10 ** d) / 10 ** d;
const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export function view(b) {
  const pct = b.limitUsd > 0 ? b.spentUsd / b.limitUsd : 1;
  const state = pct >= 1 ? "tripped" : pct >= b.softPct ? "warning" : "armed";
  return {
    id: b.id,
    name: b.name,
    limitUsd: b.limitUsd,
    softPct: b.softPct,
    spentUsd: round(b.spentUsd),
    remainingUsd: round(Math.max(0, b.limitUsd - b.spentUsd)),
    percentUsed: round(pct * 100, 2),
    state,
    softAlert: pct >= b.softPct,
    hardStop: pct >= 1,
    inputTokens: b.inputTokens,
    outputTokens: b.outputTokens,
    calls: b.calls,
    blockedCalls: b.blockedCalls,
    softAlertAt: b.softAlertAt || null,
    trippedAt: b.trippedAt || null,
    createdAt: b.createdAt,
  };
}

export function setBudget({ id, name, limitUsd, softPct = 0.8, reset = false }) {
  load();
  const limit = Number(limitUsd);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 1e6) throw new BudgetError("limitUsd must be a number > 0 and <= 1,000,000");
  const soft = Number(softPct);
  if (!Number.isFinite(soft) || soft <= 0 || soft >= 1) throw new BudgetError("softPct must be between 0 and 1 (exclusive), e.g. 0.8");
  const bid = slug(id || name || "");
  if (!bid) throw new BudgetError("id or name is required");
  let b = store.budgets.get(bid);
  if (!b) {
    if (store.budgets.size >= MAX_BUDGETS) throw new BudgetError(`budget limit reached (${MAX_BUDGETS}); delete one first`);
    b = { id: bid, name: String(name || bid).slice(0, 60), spentUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0, blockedCalls: 0, events: [], createdAt: new Date().toISOString() };
    store.budgets.set(bid, b);
  }
  if (name) b.name = String(name).slice(0, 60);
  b.limitUsd = limit;
  b.softPct = soft;
  if (reset) Object.assign(b, { spentUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0, blockedCalls: 0, events: [], softAlertAt: null, trippedAt: null });
  refreshFlags(b);
  save();
  return view(b);
}

export class BudgetError extends Error {}

export const getBudget = (id) => (load(), store.budgets.get(slug(id || "")));
export const listBudgets = () => (load(), [...store.budgets.values()].map(view));
export const deleteBudget = (id) => (load(), store.budgets.delete(slug(id || "")) && (save(), true));

function refreshFlags(b) {
  const now = new Date().toISOString();
  if (b.spentUsd >= b.limitUsd) b.trippedAt ??= now;
  else b.trippedAt = null;
  if (b.spentUsd >= b.limitUsd * b.softPct) b.softAlertAt ??= now;
  else b.softAlertAt = null;
}

/**
 * Pre-flight decision. Blocks when already at/over the limit, or (worst case) when the projected cost
 * of this call (input estimate + max output tokens, if given) would push spend past the limit.
 */
export function checkAllow(id, { model = "default", inputTokens = 0, maxOutputTokens = 0 } = {}) {
  const b = getBudget(id);
  if (!b) return { found: false, allow: false, reason: "unknown_budget" };
  const projected = costUsd(model, inputTokens, maxOutputTokens);
  const v = view(b);
  let allow = true;
  let reason = "ok";
  if (b.spentUsd >= b.limitUsd) (allow = false), (reason = "budget_exhausted");
  else if (b.spentUsd + projected > b.limitUsd) (allow = false), (reason = "projected_cost_exceeds_remaining");
  return { found: true, allow, reason, projectedCostUsd: round(projected), budget: v };
}

export function recordBlocked(id, info) {
  const b = getBudget(id);
  if (!b) return;
  b.blockedCalls++;
  pushEvent(b, { type: "blocked", ...info });
  save();
}

function pushEvent(b, e) {
  b.events.push({ at: new Date().toISOString(), ...e });
  if (b.events.length > MAX_EVENTS) b.events.shift();
}

/** Record a completed call. usage = {input, output, estimated}. */
export function recordUsage(id, { model = "default", input, output, estimated = false, mode = "demo" }) {
  const b = getBudget(id);
  if (!b) throw new BudgetError("unknown budget");
  const cost = costUsd(model, input, output);
  const before = view(b);
  b.spentUsd += cost;
  b.inputTokens += input;
  b.outputTokens += output;
  b.calls++;
  refreshFlags(b);
  const after = view(b);
  pushEvent(b, { type: "call", mode, model, input, output, estimated, costUsd: round(cost) });
  save();
  return { costUsd: round(cost), crossedSoft: !before.softAlert && after.softAlert, crossedHard: !before.hardStop && after.hardStop, budget: after };
}

export const getEvents = (id) => getBudget(id)?.events ?? [];
