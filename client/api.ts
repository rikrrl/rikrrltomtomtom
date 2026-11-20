import type {
  ProjectDetail,
  ProjectListItem,
  ScriptSource,
  StatusResponse,
  StudioAction,
  Analysis,
} from './types';

const KEY_STORAGE = 'rsa_app_key';

export class ApiError extends Error {
  status: number;
  requiresKey: boolean;

  constructor(message: string, status: number, requiresKey = false) {
    super(message);
    this.status = status;
    this.requiresKey = requiresKey;
  }
}

export function getKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setKey(value: string) {
  try {
    if (value) localStorage.setItem(KEY_STORAGE, value);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* Speicher nicht verfügbar */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['Content-Type'] = 'application/json';
  const key = getKey();
  if (key) headers['x-app-key'] = key;

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let message = `Fehler ${response.status}`;
    let requiresKey = false;
    try {
      const data = await response.json();
      if (data?.error) message = String(data.error);
      requiresKey = Boolean(data?.requiresKey);
    } catch {
      /* keine JSON-Antwort */
    }
    throw new ApiError(message, response.status, requiresKey);
  }
  return (await response.json()) as T;
}

export const api = {
  status: () => request<StatusResponse>('/api/status'),

  listProjects: () => request<{ projects: ProjectListItem[] }>('/api/projects'),

  createProject: (body: { name: string; prompt: string; generate: boolean }) =>
    request<{ project: { id: string }; actions: number; note: string | null }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),

  renameProject: (id: string, name: string) =>
    request<{ project: unknown }>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  setAutoApprove: (id: string, autoApprove: boolean) =>
    request<{ project: unknown }>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ autoApprove }),
    }),

  deleteProject: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  generate: (id: string, prompt: string) =>
    request<{ project: unknown; note: string; actions: { id: string; summary: string }[] }>(
      `/api/projects/${id}/generate`,
      { method: 'POST', body: JSON.stringify({ prompt }) },
    ),

  chat: (id: string, message: string) => request<ProjectDetail>(`/api/projects/${id}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  }),

  listActions: (id: string, status?: string) =>
    request<{ actions: StudioAction[]; counts: Record<string, number> }>(
      `/api/projects/${id}/actions${status ? `?status=${status}` : ''}`,
    ),

  approve: (id: string, ids?: string[]) =>
    request<{ approved: number; pluginOnline: boolean }>(`/api/projects/${id}/actions/approve`, {
      method: 'POST',
      body: JSON.stringify(ids ? { ids } : {}),
    }),

  reject: (id: string, ids?: string[]) =>
    request<{ rejected: number }>(`/api/projects/${id}/actions/reject`, {
      method: 'POST',
      body: JSON.stringify(ids ? { ids } : {}),
    }),

  script: (id: string, name: string) => request<ScriptSource>(`/api/projects/${id}/scripts/${name}`),

  analyze: (id: string, body: { url: string; notes: string; screenshots: string[] }) =>
    request<{ analysis: Analysis; actions: number }>(`/api/projects/${id}/analyze`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export function pluginDownloadUrl(): string {
  return '/plugin/RobloxStudioAI.lua';
}

export function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
