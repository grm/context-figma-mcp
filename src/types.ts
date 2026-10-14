/** Minimal projection of the Figma REST document. Unknown fields are deliberately ignored. */
export interface FigmaNode {
  id: string;
  name?: string;
  type: string;
  children?: FigmaNode[];
  flowStartingPoints?: Array<{ name: string; nodeId: string }>;
  prototypeStartNodeID?: string | null;
  interactions?: FigmaInteraction[];
  transitionNodeID?: string | null;
  transitionDuration?: number | null;
  transitionEasing?: unknown;
}

export interface FigmaInteraction {
  trigger?: Record<string, unknown>;
  actions?: Array<Record<string, unknown>>;
}

export interface FigmaFile {
  name: string;
  version?: string;
  lastModified?: string;
  document: FigmaNode;
}

export interface Screen {
  id: string;
  name: string;
  pageId: string;
  pageName: string;
  type: string;
}

export interface Flow {
  name: string;
  startNodeId: string;
  startScreenId: string | null;
  pageId: string;
  pageName: string;
  isLegacy: boolean;
}

export interface Transition {
  id: string;
  sourceNodeId: string;
  sourceNodeName: string;
  sourceNodeType: string;
  screenId: string | null;
  trigger: Record<string, unknown>;
  actionType: string;
  navigationType: string | null;
  destinationId: string | null;
  destinationName: string | null;
  destinationScreenId: string | null;
  resolved: boolean | null;
  animation: unknown | null;
  details: Record<string, unknown>;
  conditionPath: string[];
  provenance: 'FIGMA_INTERACTION' | 'FIGMA_LEGACY';
}

export interface PrototypeGraph {
  file: { name: string; version: string | null; lastModified: string | null };
  flows: Flow[];
  screens: Screen[];
  transitions: Transition[];
  warnings: string[];
  stats: { screenCount: number; transitionCount: number; flowCount: number; unresolvedDestinations: number };
}
