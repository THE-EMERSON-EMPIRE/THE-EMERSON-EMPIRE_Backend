import { createHostedPracticeApp, checkHostedReadiness } from './app';
import { validateHostedPracticeEnvironment } from './profile';
import { handoffEnabled } from '../handoff/config';
import { logger } from '../utils/logger';
import { getPool } from '../db';

/** Explicit operator-applied migrations only; startup never mutates schemas. */
export async function startHostedPractice(): Promise<void> {
  try {
    validateHostedPracticeEnvironment();
    handoffEnabled();
    const port = Number(process.env.PORT ?? 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid hosted practice port');
    await checkHostedReadiness();
    const app = createHostedPracticeApp();
    const server = app.listen(port, '0.0.0.0', () => logger.success('Hosted synthetic practice service started', { port }));
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    server.maxRequestsPerSocket = 100;
    const shutdown = () => {
      server.close(() => { void getPool().end().then(() => process.exit(0)).catch(() => process.exit(1)); });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (error) {
    logger.error('Hosted practice startup failed', { errorType: error instanceof Error ? error.name : 'Error' });
    process.exitCode = 1;
  }
}

if (require.main === module) void startHostedPractice();
