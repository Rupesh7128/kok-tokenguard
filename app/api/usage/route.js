import { NextResponse } from "next/server";
import { getBudget, getEvents, view } from "../../../lib/budget.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req) {
  const id = new URL(req.url).searchParams.get("id");
  const b = getBudget(id);
  if (!b) return NextResponse.json({ error: "unknown budget; pass ?id=" }, { status: 404 });
  return NextResponse.json({ budget: view(b), events: getEvents(id).slice(-50) });
}
