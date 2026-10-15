import type { FigmaFile, FigmaNode, Flow, PrototypeGraph, Screen, Transition } from './types.ts';

const FRAMES = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string | null => typeof value === 'string' ? value : null;

interface IndexedNode {
  node: FigmaNode;
  pageId: string;
  pageName: string;
  screenId: string | null;
}

export function buildPrototypeGraph(file: FigmaFile): PrototypeGraph {
  const screens: Screen[] = [];
  const flows: Flow[] = [];
  const transitions: Transition[] = [];
  const warnings = new Set<string>();
  const index = new Map<string, IndexedNode>();

  /** A top-level frame is a screen. Nested component instances belong to the enclosing screen. */
  function visit(node: FigmaNode, page: FigmaNode | null, topScreen: string | null): void {
    const currentPage = node.type === 'CANVAS' ? node : page;
    const isTopLevelFrame = Boolean(currentPage && node !== currentPage && topScreen === null && FRAMES.has(node.type));
    const screenId = isTopLevelFrame ? node.id : topScreen;
    if (index.has(node.id)) warnings.add(`Duplicate node ID ${node.id}; keeping the first occurrence.`);
    else index.set(node.id, { node, pageId: currentPage?.id ?? '', pageName: currentPage?.name ?? '', screenId });
    if (isTopLevelFrame && currentPage) {
      screens.push({ id: node.id, name: node.name ?? node.id, type: node.type, pageId: currentPage.id, pageName: currentPage.name ?? currentPage.id });
    }
    for (const child of node.children ?? []) visit(child, currentPage, screenId);
  }
  visit(file.document, null, null);

  for (const data of index.values()) {
    if (data.node.type !== 'CANVAS') continue;
    const points = data.node.flowStartingPoints ?? [];
    for (const point of points) {
      const target = index.get(point.nodeId);
      const startScreen = target?.screenId ?? (screens.some(s => s.id === point.nodeId) ? point.nodeId : null);
      flows.push({ name: point.name || point.nodeId, startNodeId: point.nodeId, startScreenId: startScreen, pageId: data.node.id, pageName: data.node.name ?? data.node.id, isLegacy: false });
      if (!target) warnings.add(`Flow '${point.name}' starts at missing node ${point.nodeId}.`);
    }
    if (!points.length && data.node.prototypeStartNodeID) {
      const id = data.node.prototypeStartNodeID;
      flows.push({ name: 'Default (legacy)', startNodeId: id, startScreenId: index.get(id)?.screenId ?? (screens.some(s => s.id === id) ? id : null), pageId: data.node.id, pageName: data.node.name ?? data.node.id, isLegacy: true });
    }
  }

  let sequence = 0;
  function addAction(data: IndexedNode, trigger: Record<string, unknown>, action: Record<string, unknown>, conditions: string[], provenance: Transition['provenance']): void {
    const type = str(action.type) ?? 'UNKNOWN';
    if (type === 'CONDITIONAL') {
      const blocks = Array.isArray(action.conditionalBlocks) ? action.conditionalBlocks : [];
      if (!blocks.length) warnings.add(`Conditional action at ${data.node.id} has no conditional blocks.`);
      blocks.forEach((block, i) => {
        const b = record(block);
        // Figma ConditionalBlock: condition (expression) + actions (array).
        const label = `block[${i}]: ${JSON.stringify(b.condition ?? null)}`;
        const actions = Array.isArray(b.actions) ? b.actions : [];
        actions.forEach(next => addAction(data, trigger, record(next), [...conditions, label], provenance));
      });
      return;
    }
    const destinationId = str(action.destinationId) ?? (provenance === 'FIGMA_LEGACY' ? str(action.transitionNodeID) : null);
    const destination = destinationId ? index.get(destinationId) : undefined;
    const navigation = record(action.navigation);
    const details: Record<string, unknown> = {};
    for (const key of ['url', 'variableId', 'variableValue', 'variableCollectionId', 'variableModeId', 'mediaAction', 'preserveScrollPosition', 'resetScrollPosition', 'resetInteractiveComponents', 'overlayRelativePosition']) {
      if (key in action) details[key] = action[key];
    }
    const destinationScreenId = destination?.screenId ?? (destination && screens.some(s => s.id === destinationId) ? destinationId : null);
    const edge: Transition = {
      id: `interaction-${++sequence}`,
      sourceNodeId: data.node.id,
      sourceNodeName: data.node.name ?? data.node.id,
      sourceNodeType: data.node.type,
      screenId: data.screenId,
      trigger,
      actionType: type,
      navigationType: str(navigation.type),
      destinationId,
      destinationName: destination?.node.name ?? null,
      destinationScreenId,
      resolved: destinationId === null ? null : Boolean(destination),
      animation: action.transition ?? null,
      details,
      conditionPath: conditions,
      provenance,
    };
    transitions.push(edge);
    if (destinationId && !destination) warnings.add(`Unresolved destination ${destinationId} from node ${data.node.id} (${type}).`);
    if (type === 'NODE' && !destinationId) warnings.add(`NODE action from ${data.node.id} has no destinationId.`);
  }

  for (const data of index.values()) {
    const list = data.node.interactions ?? [];
    for (const interaction of list) {
      const trigger = record(interaction.trigger);
      const actions = Array.isArray(interaction.actions) ? interaction.actions : [];
      if (!actions.length) warnings.add(`Interaction on ${data.node.id} has no actions.`);
      for (const action of actions) addAction(data, trigger, record(action), [], 'FIGMA_INTERACTION');
    }
    // Old Figma files may expose only transitionNodeID. Never count both representations.
    if (!list.length && data.node.transitionNodeID) {
      addAction(data, { type: 'LEGACY' }, { type: 'NODE', destinationId: data.node.transitionNodeID, navigation: { type: 'NAVIGATE' } }, [], 'FIGMA_LEGACY');
    }
  }
  const unresolved = transitions.filter(t => t.resolved === false).length;
  return {
    file: { name: file.name, version: file.version ?? null, lastModified: file.lastModified ?? null },
    flows, screens, transitions, warnings: [...warnings],
    stats: { screenCount: screens.length, transitionCount: transitions.length, flowCount: flows.length, unresolvedDestinations: unresolved },
  };
}

export function getScreenInteractions(graph: PrototypeGraph, nodeId: string): { screen: Screen | null; interactions: Transition[]; warnings: string[] } {
  const screen = graph.screens.find(s => s.id === nodeId) ?? null;
  const interactions = graph.transitions.filter(t => t.screenId === nodeId || t.sourceNodeId === nodeId);
  return { screen, interactions, warnings: screen || interactions.length ? [] : [`Node ${nodeId} was not found as a screen or as an interaction source.`] };
}

/** Follow explicit NODE destinations only. BACK / CLOSE have no static target. */
export function reachableGraph(graph: PrototypeGraph, startNodeId: string): PrototypeGraph {
  const start = graph.screens.find(s => s.id === startNodeId);
  const fromFlow = graph.flows.find(f => f.startNodeId === startNodeId);
  const origin = start?.id ?? fromFlow?.startScreenId ?? graph.transitions.find(t => t.sourceNodeId === startNodeId)?.screenId;
  if (!origin) throw new Error(`Start node ${startNodeId} does not resolve to a known screen or flow.`);
  const seen = new Set<string>([origin]);
  const queue = [origin];
  while (queue.length) {
    const next = queue.shift()!;
    for (const edge of graph.transitions) {
      if (edge.screenId !== next || !edge.destinationScreenId || seen.has(edge.destinationScreenId)) continue;
      seen.add(edge.destinationScreenId);
      queue.push(edge.destinationScreenId);
    }
  }
  const screens = graph.screens.filter(s => seen.has(s.id));
  const transitions = graph.transitions.filter(t => t.screenId !== null && seen.has(t.screenId));
  const flows = graph.flows.filter(f => f.startScreenId !== null && seen.has(f.startScreenId));
  return {
    ...graph, screens, transitions, flows,
    stats: { screenCount: screens.length, transitionCount: transitions.length, flowCount: flows.length, unresolvedDestinations: transitions.filter(t => t.resolved === false).length },
  };
}
