import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());
const { maintainScanWorker, runWorkerOnce } = await import('../lib/scan-worker');

const workerId = process.env.IRONCLAD_WORKER_ID ?? `worker-${crypto.randomUUID()}`;
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

let lastMaintenance = 0;
while (!stopping) {
  try {
    if (Date.now() - lastMaintenance > 60 * 60_000) {
      await maintainScanWorker();
      lastMaintenance = Date.now();
    }
    const worked = await runWorkerOnce(workerId);
    if (!worked) await new Promise(resolve => setTimeout(resolve, 1_000));
  } catch (error) {
    console.error('Scan worker iteration failed', {
      workerId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown worker error',
    });
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
}
