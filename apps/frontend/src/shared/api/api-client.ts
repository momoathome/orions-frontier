import { z } from 'zod';

const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api`;

type Query = Record<string, string | number | boolean | null | undefined>;

// The auth store's token; read from memory so another tab's login does not switch this tab's account.
let authToken: string | null = null;
export const setAuthToken = (token: string | null) => {
  authToken = token;
};

// Replaced by the auth store on load; until then a 401 has no session to end.
let sessionExpired: () => void = () => undefined;
/** The auth store ends the session when the server rejects the token (HTTP 401, WS 4401). */
export const onSessionExpired = (handler: () => void) => {
  sessionExpired = handler;
};
export const expireSession = () => {
  sessionExpired();
};

const errorBodySchema = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
  message: z.string().optional(),
});

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown,
    statusText: string
  ) {
    const body = errorBodySchema.safeParse(data);
    super((body.success && (body.data.error?.message ?? body.data.message)) || statusText);
    this.name = 'ApiError';
  }
}

export const apiErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback;

async function request<T>(method: string, path: string, body?: object, params?: Query): Promise<T> {
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }

  const token = authToken;
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) expireSession();
    throw new ApiError(response.status, data, response.statusText);
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Antwort folgt dem API-Vertrag; die Route prüft ihr Schema serverseitig.
  return data as T;
}

export const apiClient = {
  get: <T>(path: string, config?: { params?: Query }) =>
    request<T>('GET', path, undefined, config?.params),
  post: <T = void>(path: string, body?: object) => request<T>('POST', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};
