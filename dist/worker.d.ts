import { getWorkerHealth as getSharedWorkerHealth } from "./monitoring/worker-state";
import { WorkerConfig } from "./types";
declare const config: WorkerConfig;
declare function gracefulShutdown(signal: string): Promise<void>;
declare function startWorker(): Promise<void>;
export { startWorker, gracefulShutdown, getSharedWorkerHealth as getWorkerHealth, config, };
//# sourceMappingURL=worker.d.ts.map