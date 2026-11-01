import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';
import { validateEnvironment } from './config/env';
import { testConnection } from './db';
import { logger } from './utils/logger';
import { portalConfig } from './security/config';
import { checkSecuritySchema } from './security/PortalService';

export async function start(): Promise<void> {
  let stage: 'environment' | 'database' | 'application' = 'environment';
  try {
    if (process.env.EPDG_SYNTHETIC_MODE || process.env.EPDG_HOSTED_PRACTICE_MODE) {
      throw new Error('Practice modes require their dedicated entrypoint');
    }
    const { port } = validateEnvironment();
    portalConfig();
    stage = 'database';
    await testConnection();
    await checkSecuritySchema();
    logger.success('Database connected successfully');

    stage = 'application';
    const app = createApp({ readinessCheck: async () => { await testConnection(); await checkSecuritySchema(); } });
    app.listen(port, () => {
      logger.success('Server started', { port });
    });
  } catch (error) {
    logger.error('Backend startup failed', {
      stage,
      errorType: error instanceof Error ? error.name : 'Error',
    });
    process.exit(1);
  }
}

if (require.main === module) {
  void start();
}
