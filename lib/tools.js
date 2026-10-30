/** Tool definitions shared by the stdio MCP server and the hosted /api/mcp endpoint. */
import { BudgetError, checkAllow, estimateTokens, getBudget, getEvents, setBudget, view } from "./budget.js";

const usd = (n) => `$${Number(n).toFixed(4)}`;

export function chargebackMarkdown(id, { team, period } = {}) {
  const b = getBudget(id);
  if (!b) throw new BudgetError(`unknown budget "${id}"`);
  const v = view(b);
  const calls = getEvents(id).filter((e) => e.type === "call");
  const byModel = {};
  for (const c of calls) {
    const m = (byModel[c.model] ??= { calls: 0, input: 0, output: 0, cost: 0 });
    m.calls++;
    m.input += c.input;
    m.output += c.output;
    m.cost += c.costUsd;
  }
  const lines = [
    `*LLM spend chargeback: ${team || v.name}*${period ? ` (${period})` : ""}`,
    `Budget \`${v.id}\`: ${usd(v.spentUsd)} of ${usd(v.limitUsd)} used (${v.percentUsed}%), state *${v.state.toUpperCase()}*`,
    `Tokens: ${v.inputTokens.toLocaleString("en-US")} in / ${v.outputTokens.toLocaleString("en-US")} out across ${v.calls} calls; ${v.blockedCalls} calls blocked by the hard stop.`,
  ];
  const rows = Object.entries(byModel);
  if (rows.length) {
    lines.push("", "By model (last 100 events held in memory):");
    for (const [m, r] of rows) lines.push(`• \`${m}\`: ${r.calls} calls, ${r.input}/${r.output} tokens, ${usd(r.cost)}`);
  }
  if (v.softAlertAt) lines.push("", `:warning: Soft alert (${Math.round(v.softPct * 100)}%) first crossed ${v.softAlertAt}.`);
  if (v.trippedAt) lines.push(`:no_entry: Hard stop tripped ${v.trippedAt}. Further calls return HTTP 429 until the budget is raised or reset.`);
  lines.push("", "_Costs use the configured price table, not an invoice. Reconcile against the provider bill before charging a team._");
  return lines.join("\n");
}

const budgetProp = { type: "string", description: "Budget id" };

export const TOOLS = [
  {
    name: "set_budget",
    description: "Create or update a USD budget for an agent/team. softPct defaults to 0.8. Set reset=true to zero the counters.",
    inputSchema: {
      type: "object",
      properties: {
        id: budgetProp,
        name: { type: "string" },
        limitUsd: { type: "number", description: "Hard-stop limit in USD" },
        softPct: { type: "number", description: "Soft alert fraction, default 0.8" },
        reset: { type: "boolean" },
      },
      required: ["id", "limitUsd"],
    },
    run: async (a) => setBudget({ id: a.id, name: a.name, limitUsd: a.limitUsd, softPct: a.softPct ?? 0.8, reset: !!a.reset }),
  },
  {
    name: "get_usage",
    description: "Current spend, tokens, calls, soft-alert and hard-stop state for a budget.",
    inputSchema: { type: "object", properties: { id: budgetProp }, required: ["id"] },
    run: async (a) => {
      const b = getBudget(a.id);
      if (!b) throw new BudgetError(`unknown budget "${a.id}"`);
      return view(b);
    },
  },
  {
    name: "check_allow",
    description: "Ask the circuit breaker whether a call would be allowed, without making it. Give text (tokens estimated as chars/4) or inputTokens, plus maxOutputTokens for a worst-case check.",
    inputSchema: {
      type: "object",
      properties: {
        id: budgetProp,
        model: { type: "string" },
        text: { type: "string" },
        inputTokens: { type: "number" },
        maxOutputTokens: { type: "number" },
      },
      required: ["id"],
    },
    run: async (a) => {
      const inputTokens = Number.isFinite(+a.inputTokens) ? +a.inputTokens : estimateTokens(a.text);
      return checkAllow(a.id, { model: a.model || "default", inputTokens, maxOutputTokens: Number(a.maxOutputTokens) || 0 });
    },
  },
  {
    name: "draft_slack_chargeback",
    description: "Draft (not send) a Slack-formatted chargeback message for a budget. Built only from recorded usage.",
    inputSchema: {
      type: "object",
      properties: { id: budgetProp, team: { type: "string" }, period: { type: "string", description: 'e.g. "Nov 2026"' } },
      required: ["id"],
    },
    run: async (a) => ({ markdown: chargebackMarkdown(a.id, { team: a.team, period: a.period }) }),
  },
];

export const asText = (out) => (typeof out.markdown === "string" ? out.markdown : JSON.stringify(out, null, 2));
