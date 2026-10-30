import { NextResponse } from "next/server";
import { listBudgets, priceTable } from "../../../lib/budget.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "kok-tokenguard",
    version: "0.1.0",
    modes: ["demo (mock upstream, simulated tokens)", "passthrough (caller Authorization -> OPENAI_BASE_URL)"],
    budgets: listBudgets().length,
    models: Object.keys(priceTable()),
    store: process.env.TOKENGUARD_STATE_FILE ? "file" : "memory",
  });
}
