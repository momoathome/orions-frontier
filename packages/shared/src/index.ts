// ============================================================================
// Result Type (für funktionale Error Handling)
// ============================================================================

export type Result<T, E = Error> = Success<T> | Failure<E>;

export interface Success<T> {
  success: true;
  data: T;
}

export interface Failure<E> {
  success: false;
  error: E;
}

export const success = <T>(data: T): Success<T> => ({
  success: true,
  data,
});

export const failure = <E>(error: E): Failure<E> => ({
  success: false,
  error,
});

export const isSuccess = <T, E>(result: Result<T, E>): result is Success<T> =>
  result.success === true;

export const isFailure = <T, E>(result: Result<T, E>): result is Failure<E> =>
  result.success === false;

// ============================================================================
// App Errors
// ============================================================================

export enum ErrorCode {
  // Auth
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',

  // Resources
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',

  // System
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// ============================================================================
// Constants
// ============================================================================

export const APP_CONSTANTS = {
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 50,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  SESSION_DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours
  TOKEN_EXPIRY_MS: 24 * 60 * 60 * 1000, // 24 hours
  WS_PING_INTERVAL_MS: 30 * 1000, // 30 seconds
  WS_PONG_TIMEOUT_MS: 5 * 1000, // 5 seconds
} as const;

// ============================================================================
// Utilities
// ============================================================================

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const retry = async <T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    delay: number;
    onRetry?: (error: Error, attempt: number) => void;
  }
): Promise<T> => {
  let lastError: Error;

  for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < options.maxRetries) {
        options.onRetry?.(lastError, attempt);
        await sleep(options.delay);
      }
    }
  }

  throw lastError!;
};

export const chunk = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

export const groupBy = <T, K extends string | number | symbol>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> => {
  return array.reduce(
    (acc, item) => {
      const key = keyFn(item);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    },
    {} as Record<K, T[]>
  );
};

export * from './result';
export * from './errors';
export * from './constants';
export * from './utils';
export * from './auth';
export * from './station';
export * from './station-spacecraft';
export * from './station-resource';
export * from './resource';
export * from './building';
