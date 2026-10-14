import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrototypeGraph, reachableGraph, getScreenInteractions } from '../src/prototype-parser.ts';
import { parseFigmaFileKey, parseFigmaNodeId, FigmaClient } from '../src/figma-client.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/prototype.json', import.meta.url), 'utf8'));
const graph = buildPrototypeGraph(fixture);

test('flows and source screen resolution', () => {
  assert.equal(graph.flows[0].name, 'Edit email');
  assert.equal(graph.flows[0].startScreenId, '1:1');
  assert.equal(graph.screens.length, 5);
  assert.equal(graph.stats.flowCount, 1);
});

test('Figma NODE action and transition metadata are preserved', () => {
  const t = graph.transitions.find(t => t.sourceNodeId === '1:10');
  assert.equal(t?.screenId, '1:1');
  assert.equal(t?.navigationType, 'NAVIGATE');
  assert.equal(t?.destinationScreenId, '1:2');
  assert.deepEqual(t?.animation, { type: 'DISSOLVE', duration: 250 });
  assert.equal(t?.provenance, 'FIGMA_INTERACTION');
});

test('BACK/CLOSE are not invented as explicit navigation targets', () => {
  for (const action of ['BACK', 'CLOSE']) {
    const t = graph.transitions.find(t => t.actionType === action);
    assert.equal(t?.destinationId, null);
    assert.equal(t?.resolved, null);
  }
});

test('conditional paths and overlays are captured as distinct branches', () => {
  const e = graph.transitions.filter(t => t.sourceNodeId === '1:21');
  assert.equal(e.length, 2);
  assert.deepEqual(e.map(t => t.navigationType), ['NAVIGATE', 'OVERLAY']);
  assert.ok(e.every(t => t.conditionPath.length === 1));
});

test('legacy transitions are only considered in absence of interactions', () => {
  const t = graph.transitions.find(t => t.sourceNodeId === '1:22');
  assert.equal(t?.provenance, 'FIGMA_LEGACY');
  assert.equal(t?.destinationId, '1:3');
});

test('unresolved destinations remain explicit, never guessed', () => {
  const t = graph.transitions.find(t => t.sourceNodeId === '1:23');
  assert.equal(t?.resolved, false);
  assert.equal(t?.destinationScreenId, null);
  assert.ok(graph.warnings.some(w => w.includes('99:99')));
});

test('reachability follows only declared edges', () => {
  const result = reachableGraph(graph, '1:1');
  assert.ok(result.screens.some(s => s.id === '1:4'));
  assert.ok(!result.screens.some(s => s.id === '1:5'));
  assert.throws(() => reachableGraph(graph, '99:99'), /does not resolve/);
});

test('screen scoped lookup includes nested button interactions', () => {
  const data = getScreenInteractions(graph, '1:2');
  assert.equal(data.screen?.name, 'Edit email');
  assert.ok(data.interactions.some(t => t.actionType === 'BACK'));
});

test('Figma URL and node ID validation rejects external hosts', () => {
  assert.equal(parseFigmaFileKey('https://www.figma.com/design/AbCd123456/My-Design?node-id=1-2'), 'AbCd123456');
  assert.equal(parseFigmaNodeId('1-234'), '1:234');
  assert.throws(() => parseFigmaFileKey('https://attacker.example/design/AbCd123456/x'), /Only https/);
});

test('Figma client sends token as header and handles 403 without leaking token', async () => {
  let requestedUrl = '';
  const client = new FigmaClient('super-secret-token', async (url, opts) => {
    requestedUrl = String(url);
    assert.equal(opts?.headers?.['X-Figma-Token'], 'super-secret-token');
    return new Response('{}', { status: 403 });
  });
  await assert.rejects(client.getFile('AbCd123456'), /Invalid token/);
  assert.equal(requestedUrl, 'https://api.figma.com/v1/files/AbCd123456');
});
