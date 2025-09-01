import { Job, JobResult, ValidationError } from "../types";
import {
  updateJobProgress,
  updateUploadStatus,
  getUpload,
  markJobFailed,
} from "../utils/database";
import { downloadChunksAsStream, cleanupUploadChunks } from "../utils/storage";
import { validateAndProcessCSVStream } from "../utils/validation";

const BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE || "1000");
const HEARTBEAT_INTERVAL = parseInt(
  process.env.WORKER_HEARTBEAT_INTERVAL || "30000"
);
const CONCURRENT_BATCHES = parseInt(
  process.env.WORKER_CONCURRENT_BATCHES || "5"
);

/**
 * Process a CSV upload job
 * This is the main processing function adapted from existing upload-connections.js
 */
export async function processCSVJob(job: Job): Promise<JobResult> {
  const startTime = Date.now();
  let heartbeatTimer: NodeJS.Timeout | null = null;

  try {
    console.log(
      `🚀 Starting CSV processing for job ${job.id} (upload ${job.upload_id})`
    );

    // Start heartbeat to show job is active
    heartbeatTimer = setInterval(async () => {
      try {
        await updateJobProgress(job.id, null, null, null, true);
      } catch (error) {
        console.warn("Heartbeat update failed:", error);
      }
    }, HEARTBEAT_INTERVAL);

    // Update job status to running
    await updateJobProgress(job.id, "running", 0, null, true);

    // Get upload details
    const upload = await getUpload(job.upload_id);
    console.log(
      `📄 Processing upload: ${upload.filename} (${upload.bytes_total} bytes) for user: ${upload.user_id}`
    );

    // Update upload status to processing
    await updateUploadStatus(job.upload_id, "processing", null, null);

    // Download and combine chunks from storage
    console.log("📥 Downloading CSV chunks from storage...");
    const csvStream = await downloadChunksAsStream(
      job.upload_id,
      upload.filename
    );

    // Validate and process rows with duplicate checking
    console.log("✅ Validating and processing rows...");
    const processingResult = await validateAndProcessCSVStream(
      csvStream,
      upload.user_id,
      BATCH_SIZE,
      CONCURRENT_BATCHES,
      async (progress) => {
        await updateJobProgress(job.id, "running", progress, null, true);
      },
      upload.bytes_total // Pass file size for Phase 1 optimizations
    );

    console.log(
      `📊 Final results: ${processingResult.processed} inserted, ${processingResult.duplicates} duplicates, ${processingResult.total} total valid rows`
    );

    // Final progress update
    await updateJobProgress(job.id, "running", 100, null, true);

    // Update upload status to completed
    await updateUploadStatus(
      job.upload_id,
      "completed",
      upload.bytes_total,
      null
    );

    // Mark job as succeeded
    await updateJobProgress(job.id, "succeeded", 100, null, true, {
      processedRecords: processingResult.processed,
      duplicateRecords: processingResult.duplicates,
      totalRecords: processingResult.total,
      success: true,
    });

    // Clean up storage chunks
    console.log("🧹 Cleaning up storage chunks...");
    await cleanupUploadChunks(job.upload_id);

    const duration = Date.now() - startTime;
    console.log(`🎉 CSV processing completed successfully in ${duration}ms`);

    return {
      success: true,
      processedRecords: processingResult.processed,
      duplicateRecords: processingResult.duplicates,
      totalRecords: processingResult.total,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ CSV processing failed after ${duration}ms:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      // Mark upload as failed
      await updateUploadStatus(job.upload_id, "failed", null, errorMessage);

      // Mark job as failed with retry logic
      const failureResult = await markJobFailed(job.id, errorMessage);

      if (failureResult.willRetry) {
        console.log(
          `🔄 Job will be retried (attempt ${failureResult.attempts})`
        );
      } else {
        console.log(
          `💀 Job failed permanently after ${failureResult.attempts} attempts`
        );
      }
    } catch (updateError) {
      console.error(
        "Failed to update job/upload status after error:",
        updateError
      );
    }

    return {
      success: false,
      processedRecords: 0,
      duplicateRecords: 0,
      totalRecords: 0,
      error: errorMessage,
    };
  } finally {
    // Clear heartbeat timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }
}

/**
 * Validate job before processing
 */
export function validateJob(job: Job): void {
  if (!job.id || !job.upload_id) {
    throw new ValidationError("Job missing required fields: id, upload_id");
  }

  if (job.type !== "csv_process") {
    throw new ValidationError(`Unsupported job type: ${job.type}`);
  }

  if (job.status !== "running") {
    throw new ValidationError(
      `Job status should be 'running', got: ${job.status}`
    );
  }
}

/**
 * Get processing statistics
 */
export function getProcessingStats(result: JobResult): string {
  if (!result.success) {
    return `Processing failed: ${result.error}`;
  }

  const total = result.processedRecords + result.duplicateRecords;
  const successRate =
    result.totalRecords > 0
      ? Math.round((total / result.totalRecords) * 100)
      : 0;

  return `Processing completed: ${result.processedRecords} inserted, ${result.duplicateRecords} duplicates, ${result.totalRecords} total (${successRate}% success rate)`;
}
