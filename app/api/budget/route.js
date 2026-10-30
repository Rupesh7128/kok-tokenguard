import { NextResponse } from "next/server";
import { BudgetError, deleteBudget, getBudget, listBudgets, setBudget, view } from "../../../lib/budget.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (m, s = 400) => NextResponse.json({ error: m }, { status: s });

export function GET(req) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ budgets: listBudgets() });
  const b = getBudget(id);
  return b ? NextResponse.json(view(b)) : bad("unknown budget", 404);
}

/** Create or update. Body: { id|name, limitUsd, softPct?, reset? } */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return bad("invalid JSON");
  }
  try {
    return NextResponse.json(setBudget(body || {}));
  } catch (e) {
    if (e instanceof BudgetError) return bad(e.message);
    throw e;
  }
}

export function DELETE(req) {
  const id = new URL(req.url).searchParams.get("id");
  return deleteBudget(id) ? NextResponse.json({ deleted: id }) : bad("unknown budget", 404);
}
