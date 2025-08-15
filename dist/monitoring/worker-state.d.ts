import type { Job, WorkerConfig } from '../types/index.js';
export declare function setWorkerRunning(running: boolean): void;
export declare function setWorkerShuttingDown(shuttingDown: boolean): void;
export declare function setCurrentJob(job: Job | null): void;
export declare function incrementJobsProcessed(): void;
export declare function setWorkerConfig(config: Partial<WorkerConfig>): void;
export declare function getWorkerHealth(): {
    status: string;
    isShuttingDown: boolean;
    currentJob: any;
    jobsProcessed: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    config: any;
};
export declare function resetWorkerState(): void;
//# sourceMappingURL=worker-state.d.ts.map