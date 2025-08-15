/**
 * Shared worker state for health monitoring
 * This module prevents circular imports between worker.ts and health-server.ts
 */

import type { Job, WorkerConfig } from '../types/index.js';

// Worker state
let isRunning = false;
let isShuttingDown = false;
let currentJob: Job | null = null;
let jobsProcessed = 0;
let startTime = Date.now();
let workerConfig: Partial<WorkerConfig> = {};

/**
 * Update worker running state
 */
export function setWorkerRunning(running: boolean): void {
  isRunning = running;
  if (running && startTime === 0) {
    startTime = Date.now();
  }
}

/**
 * Update worker shutdown state
 */
export function setWorkerShuttingDown(shuttingDown: boolean): void {
  isShuttingDown = shuttingDown;
}

/**
 * Update current job
 */
export function setCurrentJob(job: Job | null): void {
  currentJob = job;
}

/**
 * Increment jobs processed counter
 */
export function incrementJobsProcessed(): void {
  jobsProcessed++;
}

/**
 * Set worker configuration
 */
export function setWorkerConfig(config: Partial<WorkerConfig>): void {
  workerConfig = config;
}

/**
 * Get worker health status
 */
export function getWorkerHealth(): {
  status: string;
  isShuttingDown: boolean;
  currentJob: any;
  jobsProcessed: number;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  config: any;
} {
  return {
    status: isRunning ? 'running' : 'stopped',
    isShuttingDown,
    currentJob: currentJob ? {
      id: currentJob.id,
      uploadId: currentJob.upload_id,
      startedAt: currentJob.updated_at
    } : null,
    jobsProcessed,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    config: {
      pollInterval: workerConfig.pollInterval,
      batchSize: workerConfig.batchSize,
      maxRetries: workerConfig.maxRetries
    }
  };
}

/**
 * Reset worker state (for testing)
 */
export function resetWorkerState(): void {
  isRunning = false;
  isShuttingDown = false;
  currentJob = null;
  jobsProcessed = 0;
  startTime = 0;
}
