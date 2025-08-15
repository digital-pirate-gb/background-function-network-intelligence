import { WorkerConfig } from './types';
declare const config: WorkerConfig;
declare function gracefulShutdown(signal: string): Promise<void>;
declare function startWorker(): Promise<void>;
declare function getWorkerHealth(): object;
export { startWorker, gracefulShutdown, getWorkerHealth, config };
//# sourceMappingURL=worker.d.ts.map