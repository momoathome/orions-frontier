import type { FastifyPluginAsync } from 'fastify';
import { AppError, ErrorCode } from '@orions-frontier/shared';

export const errorHandler: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(getStatusCode(error.code)).send({
        success: false,
        error: error.toJSON(),
      });
    }

    // Validation errors
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Validation failed',
          details: error.validation,
        },
      });
    }

    // Default error
    fastify.log.error(error);
    return reply.status(500).send({
      success: false,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
      },
    });
  });
};

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
