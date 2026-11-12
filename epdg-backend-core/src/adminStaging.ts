import dotenv from 'dotenv';
dotenv.config();

import { validateEnvironment } from './config/env';
import { isNeonAdminStaging } from './neon-admin-staging/profile';
import { testConnection } from './db';
import { checkSecuritySchema } from './security/PortalService';
import { portalConfig } from './security/config';
import { createAdminStagingApp } from './adminStagingApp';
import { logger } from './utils/logger';

export async function startAdminStaging(): Promise<void> {
  let stage: 'profile' | 'database' | 'application' = 'profile';
  try {
    if (!isNeonAdminStaging()) throw new Error('Neon staging profile required');
    const { port } = validateEnvironment();
    portalConfig();
    stage = 'database';
    await testConnection();
    await checkSecuritySchema();
    stage = 'application';
    const app = createAdminStagingApp({ readinessCheck: async () => {
      await testConnection();
      await checkSecuritySchema();
    } });
    app.listen(port, () => logger.success('Isolated administrator staging API started', { port }));
  } catch (error) {
    logger.error('Administrator staging startup failed', {
      stage, errorType: error instanceof Error ? error.name : 'Error',
    });
    process.exit(1);
  }
}

if (require.main === module) void startAdminStaging();
