import { supabase } from "../config/supabase";
import {
  Job,
  Upload,
  JobStatus,
  JobType,
  UploadStatus,
  ProcessedConnection,
  BatchProcessResult,
  DatabaseError,
} from "../types";

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  exponentialBackoff: true,
};

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate retry delay with exponential backoff
 */
function calculateRetryDelay(attempt: number): number {
  if (!RETRY_CONFIG.exponentialBackoff) {
    return RETRY_CONFIG.baseDelay;
  }

  const delay = RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1);
  return Math.min(delay, RETRY_CONFIG.maxDelay);
}

/**
 * Retry wrapper for database operations
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = RETRY_CONFIG.maxRetries
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on certain types of errors
      if (error instanceof DatabaseError && error.code === "VALIDATION_ERROR") {
        throw error;
      }

      if (attempt === maxRetries) {
        console.error(
          `❌ ${operationName} failed after ${maxRetries} attempts:`,
          lastError.message
        );
        throw lastError;
      }

      const delay = calculateRetryDelay(attempt);
      console.warn(
        `⚠️ ${operationName} attempt ${attempt} failed, retrying in ${delay}ms:`,
        lastError.message
      );
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Get the next queued job for processing with retry logic
 */
export async function getNextJob(
  jobType: JobType = "csv_process"
): Promise<Job | null> {
  return withRetry(
    async () => {
      const { data, error } = await supabase.rpc("get_next_job", {
        p_job_type: jobType,
      });

      if (error) {
        throw new DatabaseError(`Failed to get next job: ${error.message}`);
      }

      // If RPC returns a row with all null values, treat it as no job available
      if (data && data.id === null) {
        return null;
      }

      return data;
    },
    "Get next job",
    2
  ); // Fewer retries for job polling
}

/**
 * Update job progress and status with retry logic
 */
export async function updateJobProgress(
  jobId: string,
  status: JobStatus | null = null,
  progress: number | null = null,
  error: string | null = null,
  heartbeat: boolean = true,
  result: any = null
): Promise<Job> {
  return withRetry(async () => {
    const { data, error: updateError } = await supabase.rpc(
      "update_job_progress",
      {
        p_job_id: jobId,
        p_status: status,
        p_progress: progress,
        p_error: error,
        p_heartbeat: heartbeat,
        p_result: result,
      }
    );

    if (updateError) {
      throw new DatabaseError(
        `Failed to update job progress: ${updateError.message}`,
        jobId
      );
    }

    return data;
  }, `Update job progress for ${jobId}`);
}

/**
 * Update upload status with retry logic
 */
export async function updateUploadStatus(
  uploadId: string,
  status: UploadStatus | null = null,
  bytesUploaded: number | null = null,
  error: string | null = null
): Promise<Upload> {
  return withRetry(async () => {
    const { data, error: updateError } = await supabase.rpc(
      "update_upload_status",
      {
        p_upload_id: uploadId,
        p_status: status,
        p_bytes_uploaded: bytesUploaded,
        p_error: error,
      }
    );

    if (updateError) {
      throw new DatabaseError(
        `Failed to update upload status: ${updateError.message}`,
        undefined,
        uploadId
      );
    }

    return data;
  }, `Update upload status for ${uploadId}`);
}

/**
 * Get upload details
 */
export async function getUpload(uploadId: string): Promise<Upload> {
  try {
    const { data, error } = await supabase
      .from("uploads")
      .select("*")
      .eq("id", uploadId)
      .single();

    if (error) {
      throw new DatabaseError(
        `Failed to get upload: ${error.message}`,
        undefined,
        uploadId
      );
    }

    return data;
  } catch (error) {
    console.error("Error getting upload:", error);
    throw error;
  }
}

/**
 * Batch insert LinkedIn connections with retry logic and better error handling
 */
export async function batchInsertConnections(
  connections: ProcessedConnection[]
): Promise<BatchProcessResult[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc("process_connections_batch", {
      records: connections,
    });

    if (error) {
      throw new DatabaseError(
        `Failed to insert connections batch: ${error.message}`
      );
    }

    return data || [];
  }, `Batch insert of ${connections.length} connections`);
}

/**
 * Debug: Check what jobs exist in the database
 */
export async function debugJobsTable(): Promise<void> {
  try {
    console.log("🔍 Debugging jobs table...");

    const { data: allJobs, error } = await supabase
      .from("jobs")
      .select("id, upload_id, type, status, attempts, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("❌ Debug query failed:", error);
      return;
    }

    console.log(`📊 Found ${allJobs?.length || 0} total jobs (latest 10):`);
    if (allJobs && allJobs.length > 0) {
      allJobs.forEach((job) => {
        console.log(
          `  - ${job.id}: ${job.type} | ${job.status} | ${job.attempts} attempts | ${job.created_at}`
        );
      });
    } else {
      console.log("📭 No jobs found in jobs table");
    }

    // Check specifically for queued csv_process jobs
    const { data: queuedJobs, error: queuedError } = await supabase
      .from("jobs")
      .select("*")
      .eq("type", "csv_process")
      .eq("status", "queued");

    if (!queuedError && queuedJobs) {
      console.log(`🎯 Found ${queuedJobs.length} queued csv_process jobs`);
    }
  } catch (error) {
    console.error("Debug jobs table error:", error);
  }
}

/**
 * Get job statistics for monitoring
 */
export async function getJobStats(): Promise<
  Array<{ status: JobStatus; count: number }>
> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .select("status")
      .order("status");

    if (error) {
      throw new DatabaseError(`Failed to get job stats: ${error.message}`);
    }

    // Group by status manually since Supabase client doesn't support GROUP BY
    const stats: Record<string, number> = {};
    data?.forEach((job) => {
      stats[job.status] = (stats[job.status] || 0) + 1;
    });

    return Object.entries(stats).map(([status, count]) => ({
      status: status as JobStatus,
      count,
    }));
  } catch (error) {
    console.error("Error getting job stats:", error);
    return [];
  }
}

/**
 * Clean up old completed jobs (housekeeping)
 */
export async function cleanupOldJobs(daysOld: number = 7): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const { count, error } = await supabase
      .from("jobs")
      .delete({ count: "exact" })
      .in("status", ["succeeded", "failed"])
      .lt("updated_at", cutoffDate.toISOString());

    if (error) {
      throw new DatabaseError(`Failed to cleanup old jobs: ${error.message}`);
    }

    return count || 0;
  } catch (error) {
    console.error("Error cleaning up old jobs:", error);
    return 0;
  }
}

/**
 * Mark job as failed with retry logic
 */
export async function markJobFailed(
  jobId: string,
  errorMessage: string,
  maxRetries: number = 3
): Promise<{ status: JobStatus; attempts: number; willRetry: boolean }> {
  try {
    // Get current job to check retry count
    const { data: job, error: getError } = await supabase
      .from("jobs")
      .select("attempts")
      .eq("id", jobId)
      .single();

    if (getError) {
      throw new DatabaseError(
        `Failed to get job for retry check: ${getError.message}`,
        jobId
      );
    }

    const attempts = job.attempts || 0;
    const newStatus: JobStatus = attempts < maxRetries ? "retrying" : "failed";

    await updateJobProgress(jobId, newStatus, null, errorMessage, true);

    return {
      status: newStatus,
      attempts: attempts + 1,
      willRetry: newStatus === "retrying",
    };
  } catch (error) {
    console.error("Error marking job as failed:", error);
    throw error;
  }
}

/**
 * Get upload chunks for a specific upload
 */
export async function getUploadChunks(
  uploadId: string
): Promise<Array<{ chunk_index: number; size: number; checksum?: string }>> {
  try {
    const { data, error } = await supabase
      .from("upload_chunks")
      .select("chunk_index, size, checksum")
      .eq("upload_id", uploadId)
      .order("chunk_index");

    if (error) {
      throw new DatabaseError(
        `Failed to get upload chunks: ${error.message}`,
        undefined,
        uploadId
      );
    }

    return data || [];
  } catch (error) {
    console.error("Error getting upload chunks:", error);
    throw error;
  }
}
