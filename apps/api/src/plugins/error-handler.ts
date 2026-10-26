import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@orions-frontier/shared';

export function errorHandler(
  this: { log: { error(error: unknown): void } },
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply
) {
  if (error instanceof AppError) {
    return reply.status(getStatusCode(error.code)).send({
      error: error.toJSON(),
    });
  }

  if (error.validation) {
    return reply.status(400).send({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: error.validation,
      },
    });
  }

  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      error: {
        code: ErrorCode.INVALID_INPUT,
        message: error.message,
      },
    });
  }

  this.log.error(error);
  return reply.status(500).send({
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    },
  });
}

const getStatusCode = (code: ErrorCode): number => {
  switch (code) {
    case ErrorCode.UNAUTHORIZED:
      return 401;
    case ErrorCode.FORBIDDEN:
      return 403;
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.ALREADY_EXISTS:
      return 409;
    case ErrorCode.VALIDATION_ERROR:
    case ErrorCode.INVALID_INPUT:
    case ErrorCode.INVALID_CREDENTIALS:
      return 400;
    default:
      return 500;
  }
};
