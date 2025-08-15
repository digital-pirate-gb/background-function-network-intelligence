import dotenv from 'dotenv';
import { testConnection } from './config/supabase';
import { testStorageConnection } from './utils/storage';
import { getNextJob, getJobStats, cleanupOldJobs } from './utils/database';
import { processCSVJob, validateJob, getProcessingStats } from './processors/csv-processor';
import { WorkerConfig, Job, WorkerError } from './types';

// Load environment variables
dotenv.config();

// Worker configuration
const config: WorkerConfig = {
  pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL || '5000'),
  batchSize: parseInt(process.env.WORKER_BATCH_SIZE || '1000'),
  maxRetries: parseInt(process.env.WORKER_MAX_RETRIES || '3'),
  heartbeatInterval: parseInt(process.env.WORKER_HEARTBEAT_INTERVAL || '30000'),
  storageBucket: process.env.STORAGE_BUCKET || 'csv-uploads',
  chunkSize: parseInt(process.env.CHUNK_SIZE || '5242880')
};

// Worker state
let isRunning = false;
let isShuttingDown = false;
let currentJob: Job | null = null;
let jobsProcessed = 0;
let lastCleanup = Date.now();

/**
 * Main worker loop
 */
async function workerLoop(): Promise<void> {
  console.log('🔄 Starting worker loop...');

  while (isRunning && !isShuttingDown) {
    try {
      // Get next job from queue
      const job = await getNextJob('csv_process');

      if (job) {
        currentJob = job;
        console.log(`📋 Picked up job ${job.id} for upload ${job.upload_id}`);

        try {
          // Validate job before processing
          validateJob(job);

          // Process the job
          const result = await processCSVJob(job);

          // Log results
          console.log(`✅ Job ${job.id} completed: ${getProcessingStats(result)}`);
          jobsProcessed++;

        } catch (jobError) {
          const error = jobError as Error;
          console.error(`❌ Job ${job.id} failed:`, error.message);
        } finally {
          currentJob = null;
        }

      } else {
        // No jobs available, wait before polling again
        await sleep(config.pollInterval);
      }

      // Periodic cleanup (every hour)
      if (Date.now() - lastCleanup > 3600000) {
        await performCleanup();
        lastCleanup = Date.now();
      }

    } catch (error) {
      const err = error as Error;
      console.error('❌ Worker loop error:', err.message);
      await sleep(config.pollInterval * 2); // Wait longer on error
    }
  }

  console.log('🛑 Worker loop stopped');
}

/**
 * Perform periodic cleanup tasks
 */
async function performCleanup(): Promise<void> {
  try {
    console.log('🧹 Performing periodic cleanup...');

    // Clean up old completed jobs (older than 7 days)
    const cleanedJobs = await cleanupOldJobs(7);
    if (cleanedJobs > 0) {
      console.log(`🗑️ Cleaned up ${cleanedJobs} old jobs`);
    }

    // Log job statistics
    const stats = await getJobStats();
    console.log('📊 Job queue statistics:', stats);

  } catch (error) {
    const err = error as Error;
    console.warn('⚠️ Cleanup failed:', err.message);
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
  isShuttingDown = true;

  // Wait for current job to complete (with timeout)
  if (currentJob) {
    console.log(`⏳ Waiting for current job ${currentJob.id} to complete...`);

    const shutdownTimeout = 300000; // 5 minutes
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

/**
 * Initialize and start the worker
 */
async function startWorker(): Promise<void> {
  try {
    console.log('🚀 CSV Worker Service Starting...');
    console.log('📋 Configuration:', {
      pollInterval: config.pollInterval,
      batchSize: config.batchSize,
      maxRetries: config.maxRetries,
      heartbeatInterval: config.heartbeatInterval,
      storageBucket: config.storageBucket
    });

    // Test database connection
    console.log('🔌 Testing database connection...');
    await testConnection();

    // Test storage connection
    console.log('🗄️ Testing storage connection...');
    const storageOk = await testStorageConnection();
    if (!storageOk) {
      throw new WorkerError('Storage connection test failed', 'STORAGE_CONNECTION_ERROR');
    }

    // Set up signal handlers for graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // For nodemon

    // Start worker
    isRunning = true;
    console.log('✅ Worker initialized successfully');
    console.log('🔄 Starting job processing...');

    await workerLoop();

  } catch (error) {
    const err = error as Error;
    console.error('❌ Worker startup failed:', err.message);
    process.exit(1);
  }
}

/**
 * Utility function for sleeping
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Health check endpoint (for monitoring)
 */
function getWorkerHealth(): object {
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

// Start the worker if this file is run directly
if (require.main === module) {
  startWorker().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

export {
  startWorker,
  gracefulShutdown,
  getWorkerHealth,
  config
};
