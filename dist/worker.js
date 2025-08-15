"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.startWorker = startWorker;
exports.gracefulShutdown = gracefulShutdown;
exports.getWorkerHealth = getWorkerHealth;
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_1 = require("./config/supabase");
const storage_1 = require("./utils/storage");
const database_1 = require("./utils/database");
const csv_processor_1 = require("./processors/csv-processor");
const types_1 = require("./types");
dotenv_1.default.config();
const config = {
    pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL || '5000'),
    batchSize: parseInt(process.env.WORKER_BATCH_SIZE || '1000'),
    maxRetries: parseInt(process.env.WORKER_MAX_RETRIES || '3'),
    heartbeatInterval: parseInt(process.env.WORKER_HEARTBEAT_INTERVAL || '30000'),
    storageBucket: process.env.STORAGE_BUCKET || 'csv-uploads',
    chunkSize: parseInt(process.env.CHUNK_SIZE || '5242880')
};
exports.config = config;
let isRunning = false;
let isShuttingDown = false;
let currentJob = null;
let jobsProcessed = 0;
let lastCleanup = Date.now();
async function workerLoop() {
    console.log('🔄 Starting worker loop...');
    while (isRunning && !isShuttingDown) {
        try {
            const job = await (0, database_1.getNextJob)('csv_process');
            if (job) {
                currentJob = job;
                console.log(`📋 Picked up job ${job.id} for upload ${job.upload_id}`);
                try {
                    (0, csv_processor_1.validateJob)(job);
                    const result = await (0, csv_processor_1.processCSVJob)(job);
                    console.log(`✅ Job ${job.id} completed: ${(0, csv_processor_1.getProcessingStats)(result)}`);
                    jobsProcessed++;
                }
                catch (jobError) {
                    const error = jobError;
                    console.error(`❌ Job ${job.id} failed:`, error.message);
                }
                finally {
                    currentJob = null;
                }
            }
            else {
                await sleep(config.pollInterval);
            }
            if (Date.now() - lastCleanup > 3600000) {
                await performCleanup();
                lastCleanup = Date.now();
            }
        }
        catch (error) {
            const err = error;
            console.error('❌ Worker loop error:', err.message);
            await sleep(config.pollInterval * 2);
        }
    }
    console.log('🛑 Worker loop stopped');
}
async function performCleanup() {
    try {
        console.log('🧹 Performing periodic cleanup...');
        const cleanedJobs = await (0, database_1.cleanupOldJobs)(7);
        if (cleanedJobs > 0) {
            console.log(`🗑️ Cleaned up ${cleanedJobs} old jobs`);
        }
        const stats = await (0, database_1.getJobStats)();
        console.log('📊 Job queue statistics:', stats);
    }
    catch (error) {
        const err = error;
        console.warn('⚠️ Cleanup failed:', err.message);
    }
}
async function gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
    isShuttingDown = true;
    if (currentJob) {
        console.log(`⏳ Waiting for current job ${currentJob.id} to complete...`);
        const shutdownTimeout = 300000;
        const startTime = Date.now();
        while (currentJob && (Date.now() - startTime) < shutdownTimeout) {
            await sleep(1000);
        }
        if (currentJob) {
            console.log(`⚠️ Shutdown timeout reached, current job ${currentJob.id} may be incomplete`);
        }
    }
    isRunning = false;
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
}
async function startWorker() {
    try {
        console.log('🚀 CSV Worker Service Starting...');
        console.log('📋 Configuration:', {
            pollInterval: config.pollInterval,
            batchSize: config.batchSize,
            maxRetries: config.maxRetries,
            heartbeatInterval: config.heartbeatInterval,
            storageBucket: config.storageBucket
        });
        console.log('🔌 Testing database connection...');
        await (0, supabase_1.testConnection)();
        console.log('🗄️ Testing storage connection...');
        const storageOk = await (0, storage_1.testStorageConnection)();
        if (!storageOk) {
            throw new types_1.WorkerError('Storage connection test failed', 'STORAGE_CONNECTION_ERROR');
        }
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
        isRunning = true;
        console.log('✅ Worker initialized successfully');
        console.log('🔄 Starting job processing...');
        await workerLoop();
    }
    catch (error) {
        const err = error;
        console.error('❌ Worker startup failed:', err.message);
        process.exit(1);
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
            pollInterval: config.pollInterval,
            batchSize: config.batchSize,
            maxRetries: config.maxRetries
        }
    };
}
if (require.main === module) {
    startWorker().catch((error) => {
        console.error('💥 Fatal error:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=worker.js.map