export interface AiStatus {
  configured: boolean;
  mode: 'ki' | 'vorlage';
  provider: string | null;
  model: string | null;
  note: string;
}

export interface StatusResponse {
  version: string;
  ai: AiStatus;
  protected: boolean;
  projects: number;
  uptimeSeconds: number;
  plugin: { available: boolean; downloadPath: string };
  storage: { kind: string; persistentDisk: boolean; note: string };
}

export interface ProjectCounts {
  islands: number;
  pets: number;
  enemies: number;
  bosses: number;
  quests: number;
  shopItems: number;
  npcs: number;
}

export interface ActionCounts {
  pending: number;
  approved: number;
  delivered: number;
  done: number;
  failed: number;
  rejected: number;
  total: number;
}

export interface ScriptInfo {
  name: string;
  path: string;
  type: string;
  lines: number;
}

export interface ProjectListItem {
  id: string;
  name: string;
  prompt: string;
  engine: string;
  createdAt: string;
  updatedAt: string;
  pluginOnline: boolean;
  pluginLastSeen: string | null;
  placeName: string | null;
  counts: { pets: number; islands: number; enemies: number; quests: number };
  pendingActions: number;
}

export interface Project {
  id: string;
  name: string;
  prompt: string;
  engine: string;
  createdAt: string;
  updatedAt: string;
  token: string;
  settings: { autoApprove: boolean };
  plugin: {
    online: boolean;
    lastSeen: string | null;
    placeName: string | null;
    placeId: number | null;
    studioVersion: string | null;
    lastScan: string | null;
    snapshot: {
      placeName: string;
      parts: number;
      models: number;
      unanchoredParts: number;
      scripts: number;
      logs: number;
    } | null;
  };
  counts: ProjectCounts;
  summary: string | null;
  scripts: ScriptInfo[];
  actionCounts: ActionCounts;
}

export interface StudioAction {
  id: string;
  type: string;
  summary: string;
  status: 'pending' | 'approved' | 'delivered' | 'done' | 'failed' | 'rejected';
  payload: Record<string, unknown>;
  error: string | null;
  result: string | null;
  createdAt: string;
  attempts: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  meta: Record<string, unknown> | null;
}

export interface Analysis {
  id: string;
  source: string;
  mechanics: string[];
  legality: string;
  limitations: string;
  summary: string;
  engine: string;
  screenshots: number;
  actions: number;
  createdAt: string;
}

export interface ProjectDetail {
  project: Project;
  messages: ChatMessage[];
  actions: StudioAction[];
  analyses: Analysis[];
}

export interface ScriptSource {
  name: string;
  path: string;
  type: string;
  source: string;
}
