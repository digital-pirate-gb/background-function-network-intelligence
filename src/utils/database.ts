import { supabase } from '../config/supabase';
import {
  Job,
  Upload,
  JobStatus,
  JobType,
  UploadStatus,
  ProcessedConnection,
  BatchProcessResult,
  DatabaseError
} from '../types';

/**
 * Get the next queued job for processing
 */
export async function getNextJob(jobType: JobType = 'csv_process'): Promise<Job | null> {
  try {
    const { data, error } = await supabase
      .rpc('get_next_job', {
        p_job_type: jobType
      });

    if (error) {
      throw new DatabaseError(`Failed to get next job: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error getting next job:', error);
    throw error;
  }
}

/**
 * Update job progress and status
 */
export async function updateJobProgress(
  jobId: string,
  status: JobStatus | null = null,
  progress: number | null = null,
  error: string | null = null,
  heartbeat: boolean = true
): Promise<Job> {
  try {
    const { data, error: updateError } = await supabase
      .rpc('update_job_progress', {
        p_job_id: jobId,
        p_status: status,
        p_progress: progress,
        p_error: error,
        p_heartbeat: heartbeat
      });

    if (updateError) {
      throw new DatabaseError(`Failed to update job progress: ${updateError.message}`, jobId);
    }

    return data;
  } catch (error) {
    console.error('Error updating job progress:', error);
    throw error;
  }
}

/**
 * Update upload status
 */
export async function updateUploadStatus(
  uploadId: string,
  status: UploadStatus | null = null,
  bytesUploaded: number | null = null,
  error: string | null = null
): Promise<Upload> {
  try {
    const { data, error: updateError } = await supabase
      .rpc('update_upload_status', {
        p_upload_id: uploadId,
        p_status: status,
        p_bytes_uploaded: bytesUploaded,
        p_error: error
      });

    if (updateError) {
      throw new DatabaseError(`Failed to update upload status: ${updateError.message}`, undefined, uploadId);
    }

    return data;
  } catch (error) {
    console.error('Error updating upload status:', error);
    throw error;
  }
}

/**
 * Get upload details
 */
export async function getUpload(uploadId: string): Promise<Upload> {
  try {
    const { data, error } = await supabase
      .from('uploads')
      .select('*')
      .eq('id', uploadId)
      .single();

    if (error) {
      throw new DatabaseError(`Failed to get upload: ${error.message}`, undefined, uploadId);
    }

    return data;
  } catch (error) {
    console.error('Error getting upload:', error);
    throw error;
  }
}

/**
 * Batch insert LinkedIn connections (adapted from existing logic)
 */
export async function batchInsertConnections(connections: ProcessedConnection[]): Promise<BatchProcessResult[]> {
  try {
    const { data, error } = await supabase
      .rpc('process_connections_batch', {
        records: connections
      });

    if (error) {
      throw new DatabaseError(`Failed to insert connections batch: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error inserting connections batch:', error);
    throw error;
  }
}

/**
 * Get job statistics for monitoring
 */
export async function getJobStats(): Promise<Array<{ status: JobStatus; count: number }>> {
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('status, count(*)')
      .group('status');

    if (error) {
      throw new DatabaseError(`Failed to get job stats: ${error.message}`);
    }

    return data || [];
  } catch (error) {
    console.error('Error getting job stats:', error);
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

    const { data, error } = await supabase
      .from('jobs')
      .delete()
      .in('status', ['succeeded', 'failed'])
      .lt('updated_at', cutoffDate.toISOString());

    if (error) {
      throw new DatabaseError(`Failed to cleanup old jobs: ${error.message}`);
    }

    return data?.length || 0;
  } catch (error) {
    console.error('Error cleaning up old jobs:', error);
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
      .from('jobs')
      .select('attempts')
      .eq('id', jobId)
      .single();

    if (getError) {
      throw new DatabaseError(`Failed to get job for retry check: ${getError.message}`, jobId);
    }

    const attempts = job.attempts || 0;
    const newStatus: JobStatus = attempts < maxRetries ? 'retrying' : 'failed';

    await updateJobProgress(jobId, newStatus, null, errorMessage, true);

    return {
      status: newStatus,
      attempts: attempts + 1,
      willRetry: newStatus === 'retrying'
    };
  } catch (error) {
    console.error('Error marking job as failed:', error);
    throw error;
  }
}

/**
 * Get upload chunks for a specific upload
 */
export async function getUploadChunks(uploadId: string): Promise<Array<{ chunk_index: number; size: number; checksum?: string }>> {
  try {
    const { data, error } = await supabase
      .from('upload_chunks')
      .select('chunk_index, size, checksum')
      .eq('upload_id', uploadId)
      .order('chunk_index');

    if (error) {
      throw new DatabaseError(`Failed to get upload chunks: ${error.message}`, undefined, uploadId);
    }

    return data || [];
  } catch (error) {
    console.error('Error getting upload chunks:', error);
    throw error;
  }
}
