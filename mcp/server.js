#!/usr/bin/env node
/**
 * Kingdom of Kumar TokenGuard, stdio MCP server. Same tools as the hosted /api/mcp endpoint.
 * State is in this process; set TOKENGUARD_STATE_FILE=/path/state.json to persist budgets across restarts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TOOLS, asText } from "../lib/tools.js";

const server = new McpServer({ name: "kok-tokenguard", version: "0.1.0" });

const shapes = {
  set_budget: { id: z.string().min(1).max(40), name: z.string().max(60).optional(), limitUsd: z.number().positive().max(1e6), softPct: z.number().gt(0).lt(1).optional(), reset: z.boolean().optional() },
  get_usage: { id: z.string().min(1).max(40) },
  check_allow: { id: z.string().min(1).max(40), model: z.string().max(80).optional(), text: z.string().max(200000).optional(), inputTokens: z.number().nonnegative().optional(), maxOutputTokens: z.number().nonnegative().optional() },
  draft_slack_chargeback: { id: z.string().min(1).max(40), team: z.string().max(60).optional(), period: z.string().max(40).optional() },
};

for (const t of TOOLS) {
  server.tool(t.name, t.description, shapes[t.name], async (args) => {
    try {
      return { content: [{ type: "text", text: asText(await t.run(args)) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  });
}

await server.connect(new StdioServerTransport());
