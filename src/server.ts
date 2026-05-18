/**
 * Process entrypoint.
 *
 *   npm run dev    # tsx watch with --env-file=.env
 *   npm start      # node dist/server.js (after npm run build)
 *
 * Loads validated config, builds the app, binds the listening port,
 * and installs SIGINT / SIGTERM handlers for graceful shutdown.
 */

import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { closeDbClient } from './db/client.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.warn({ signal }, 'shutdown initiated');
    try {
      await app.close();
      // app.close() runs the dbPlugin's onClose hook which already calls
      // sql.end(); closeDbClient() is a no-op safety net for the singleton.
      await closeDbClient();
    } catch (err) {
      app.log.error({ err }, 'shutdown error');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.warn(
      { port: config.port, version: config.serviceVersion, env: config.nodeEnv },
      'helpan-ai-rail listening'
    );
  } catch (err) {
    app.log.error({ err }, 'listen failed');
    process.exit(1);
  }
}

void main();
