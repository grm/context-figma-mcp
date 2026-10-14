#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { FigmaClient, parseFigmaNodeId } from './figma-client.ts';
import { buildPrototypeGraph, getScreenInteractions, reachableGraph } from './prototype-parser.ts';

const fileInput = z.object({ fileKey: z.string().min(1).describe('Figma file key or https://www.figma.com/design/... URL') });
const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const fail = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Unexpected error' }] });

function createServer(): McpServer {
  const server = new McpServer({ name: 'context-figma-mcp', version: '0.1.0' });
  const client = new FigmaClient(process.env.FIGMA_TOKEN ?? '');

  server.registerTool('get_prototype_flows', {
    description: 'List explicit Figma prototype flow starting points and their pages. Read-only.',
    inputSchema: fileInput,
  }, async ({ fileKey }) => {
    try {
      const graph = buildPrototypeGraph(await client.getFile(fileKey));
      return ok({ file: graph.file, flows: graph.flows, warnings: graph.warnings.filter(w => w.startsWith('Flow ')), stats: graph.stats });
    } catch (e) { return fail(e); }
  });

  server.registerTool('get_prototype_graph', {
    description: 'Get explicit Figma prototype interactions and navigation as a provenance-aware graph; optionally limit to nodes reachable from a flow/screen. Does not infer missing links.',
    inputSchema: fileInput.extend({ startNodeId: z.string().optional().describe('Optional flow start or screen node ID, e.g. 12:345') }),
  }, async ({ fileKey, startNodeId }) => {
    try {
      const graph = buildPrototypeGraph(await client.getFile(fileKey));
      return ok(startNodeId ? reachableGraph(graph, parseFigmaNodeId(startNodeId)) : graph);
    } catch (e) { return fail(e); }
  });

  server.registerTool('get_screen_interactions', {
    description: 'Get triggers, actions, conditions and resolved destinations for one Figma screen. No AI inference.',
    inputSchema: fileInput.extend({ screenNodeId: z.string().min(1).describe('Figma screen/node ID e.g. 12:345') }),
  }, async ({ fileKey, screenNodeId }) => {
    try {
      const graph = buildPrototypeGraph(await client.getFile(fileKey));
      return ok({ file: graph.file, ...getScreenInteractions(graph, parseFigmaNodeId(screenNodeId)) });
    } catch (e) { return fail(e); }
  });
  return server;
}

// All protocol messages go to stdout; errors/logging must go to stderr.
void serveStdio(createServer).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'MCP startup failed');
  process.exitCode = 1;
});
