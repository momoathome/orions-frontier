const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api`;

type Query = Record<string, string | number | boolean | null | undefined>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown,
    statusText: string
  ) {
    const body = data as { error?: { message?: string }; message?: string } | null;
    super(body?.error?.message ?? body?.message ?? statusText);
    this.name = 'ApiError';
  }
}

export const apiErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Query
): Promise<T> {
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }

  const token = localStorage.getItem('auth_token');
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem('auth_token');
    throw new ApiError(response.status, data, response.statusText);
  }

  return data as T;
}

export const apiClient = {
  get: <T = any>(path: string, config?: { params?: Query }) =>
    request<T>('GET', path, undefined, config?.params),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body),
  delete: <T = any>(path: string) => request<T>('DELETE', path),
};
