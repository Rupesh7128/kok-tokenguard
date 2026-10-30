#!/usr/bin/env node
/**
 * Proof script: drives the REAL HTTP proxy (demo mode) until the budget trips, then confirms
 * the breaker keeps returning 429. Writes docs/sample-hard-stop.json. Uses no keys.
 * Usage: (npm run build && npm start) then: BASE=http://localhost:3000 node scripts/hard-stop.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:3000";
const id = `proof-${Date.now().toString(36)}`;
const post = (p, body, headers = {}) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const created = await (await post("/api/budget", { id, limitUsd: 0.02, softPct: 0.8 })).json();
const calls = [];
const prompt = "Draft a polite reply to a customer who was double charged. Include the refund timeline.";
let tripped = false;
for (let i = 1; i <= 200 && calls.filter((c) => c.status === 429).length < 3; i++) {
  const r = await post("/v1/chat/completions", { model: "tokenguard-demo", max_tokens: 64, messages: [{ role: "user", content: prompt }] }, { "x-tokenguard-budget": id });
  const j = await r.json();
  const row = { call: i, status: r.status, mode: r.headers.get("x-tokenguard-mode"), softAlertHeader: r.headers.get("x-tokenguard-soft-alert"), spentUsd: Number(r.headers.get("x-tokenguard-spent-usd")), remainingUsd: Number(r.headers.get("x-tokenguard-remaining-usd")) };
  if (r.status === 200) Object.assign(row, { tokens: j.tokenguard.tokens, costUsd: j.tokenguard.costUsd, crossedSoftThisCall: j.tokenguard.crossedSoftThisCall });
  else Object.assign(row, { error: j.error });
  calls.push(row);
  if (r.status === 429) tripped = true;
}
const final = await (await fetch(`${BASE}/api/usage?id=${id}`)).json();
const ok200 = calls.filter((c) => c.status === 200);
const firstSoft = ok200.find((c) => c.crossedSoftThisCall)?.call ?? null;
const firstBlock = calls.find((c) => c.status === 429)?.call ?? null;
const checks = {
  softAlertFired: firstSoft !== null,
  softBeforeHard: firstSoft !== null && (firstBlock === null || firstSoft < firstBlock),
  hardStop429: tripped,
  blockedCallsCostNothing: calls.filter((c) => c.status === 429).every((c) => c.spentUsd === calls.find((x) => x.call === firstBlock).spentUsd),
  spendNeverExceededLimit: calls.every((c) => c.spentUsd <= created.limitUsd + 1e-9),
  blockedCountMatchesServer: final.budget.blockedCalls === calls.filter((c) => c.status === 429).length,
};
const out = { generatedAt: new Date().toISOString(), base: BASE, mode: "demo (mock upstream, simulated tokens)", budget: created, summary: { successfulCalls: ok200.length, firstSoftAlertCall: firstSoft, firstBlockedCall: firstBlock }, checks, calls, finalState: final.budget };
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "sample-hard-stop.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ summary: out.summary, checks }, null, 2));
if (!Object.values(checks).every(Boolean)) process.exit(1);
