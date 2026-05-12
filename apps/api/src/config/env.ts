export const envSchema = {
  type: 'object',
  required: [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SECRET',
    'SESSION_SECRET',
  ],
  properties: {
    NODE_ENV: {
      type: 'string',
      enum: ['development', 'production', 'test'],
      default: 'development',
    },
    API_PORT: {
      type: 'string',
      default: '3000',
    },
    API_HOST: {
      type: 'string',
      default: '0.0.0.0',
    },
    DATABASE_URL: {
      type: 'string',
    },
    REDIS_URL: {
      type: 'string',
    },
    LOG_LEVEL: {
      type: 'string',
      enum: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
      default: 'info',
    },
    CORS_ORIGIN: {
      type: 'string',
      default: '*',
    },
    JWT_SECRET: {
      type: 'string',
    },
    SESSION_SECRET: {
      type: 'string',
    },
  },
};
