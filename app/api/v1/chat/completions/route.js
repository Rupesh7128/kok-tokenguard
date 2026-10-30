import { NextResponse } from "next/server";
import { handleChat } from "../../../../../lib/proxy.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { type: "invalid_request_error", code: "invalid_json", message: "Body is not valid JSON." } }, { status: 400 });
  }
  const out = await handleChat({ headers: req.headers, body });
  return NextResponse.json(out.json, { status: out.status, headers: out.headers });
}
