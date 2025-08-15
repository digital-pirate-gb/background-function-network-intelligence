"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setWorkerRunning = setWorkerRunning;
exports.setWorkerShuttingDown = setWorkerShuttingDown;
exports.setCurrentJob = setCurrentJob;
exports.incrementJobsProcessed = incrementJobsProcessed;
exports.setWorkerConfig = setWorkerConfig;
exports.getWorkerHealth = getWorkerHealth;
exports.resetWorkerState = resetWorkerState;
let isRunning = false;
let isShuttingDown = false;
let currentJob = null;
let jobsProcessed = 0;
let startTime = Date.now();
let workerConfig = {};
function setWorkerRunning(running) {
    isRunning = running;
    if (running && startTime === 0) {
        startTime = Date.now();
    }
}
function setWorkerShuttingDown(shuttingDown) {
    isShuttingDown = shuttingDown;
}
function setCurrentJob(job) {
    currentJob = job;
}
function incrementJobsProcessed() {
    jobsProcessed++;
}
function setWorkerConfig(config) {
    workerConfig = config;
}
function getWorkerHealth() {
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
function resetWorkerState() {
    isRunning = false;
    isShuttingDown = false;
    currentJob = null;
    jobsProcessed = 0;
    startTime = 0;
}
//# sourceMappingURL=worker-state.js.map