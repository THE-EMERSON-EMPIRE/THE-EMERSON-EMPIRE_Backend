import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { PortalError } from '../security/primitives';

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const candidate = err as { statusCode?: unknown; message?: unknown; name?: unknown; type?: unknown };
  const statusCode = typeof candidate?.statusCode === 'number' && candidate.statusCode >= 400 && candidate.statusCode < 600
    ? candidate.statusCode
    : 500;
  // Parser/provider errors may include submitted JSON or credentials in message.
  let publicMessage = statusCode >= 500 ? 'Internal server error' : 'Request failed';
  if (err instanceof PortalError && statusCode < 500) publicMessage = err.message;
  else if (candidate?.message === 'Origin is not allowed') publicMessage = 'Origin is not allowed';
  else if (candidate?.type === 'entity.parse.failed') publicMessage = 'Invalid JSON body';
  else if (statusCode === 413) publicMessage = 'Request body too large';
  else if (statusCode === 415) publicMessage = 'Unsupported content type';

  logger.error('Request failed', {
    method: req.method,
    statusCode,
    errorType: typeof candidate?.name === 'string' ? candidate.name : 'Error',
  });

  res.status(statusCode).json({
    success: false,
    message: publicMessage,
    errors: [],
  });
};
