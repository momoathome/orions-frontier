export enum ErrorCode {
  // Auth
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',

  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',

  // Resources
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',

  // System
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: object
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

export * from './auth.js';
export * from './station.js';
export * from './station-spacecraft.js';
export * from './station-resource.js';
export * from './resource.js';
export * from './building.js';
export * from './defense.js';
export * from './asteroid.js';
export * from './mining-trip.js';
export * from './world.js';
export * from './world-mission.js';
export * from './combat.js';
export * from './debris.js';
export * from './research.js';
export * from './type-guards.js';
export * from './realtime.js';
