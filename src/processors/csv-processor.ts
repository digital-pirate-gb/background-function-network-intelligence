import Papa from 'papaparse';
import {
  Job,
  JobResult,
  WorkerError,
  ValidationError
} from '../types';
import {
  updateJobProgress,
  updateUploadStatus,
  getUpload,
  batchInsertConnections,
  markJobFailed
} from '../utils/database';
import {
  downloadChunksAsStream,
  cleanupUploadChunks
} from '../utils/storage';
import {
  validateAndProcessCSVData,
  sanitizeCSVData,
  getValidationSummary
} from '../utils/validation';

const BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE || '1000');
const HEARTBEAT_INTERVAL = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL || '30000');

/**
 * Process a CSV upload job
 * This is the main processing function adapted from existing upload-connections.js
 */
export async function processCSVJob(job: Job): Promise<JobResult> {
  const startTime = Date.now();
  let heartbeatTimer: NodeJS.Timeout | null = null;

  try {
    console.log(`🚀 Starting CSV processing for job ${job.id} (upload ${job.upload_id})`);

    // Start heartbeat to show job is active
    heartbeatTimer = setInterval(async () => {
      try {
        await updateJobProgress(job.id, null, null, null, true);
      } catch (error) {
        console.warn('Heartbeat update failed:', error);
      }
    }, HEARTBEAT_INTERVAL);

    // Update job status to running
    await updateJobProgress(job.id, 'running', 0, null, true);

    // Get upload details
    const upload = await getUpload(job.upload_id);
    console.log(`📄 Processing upload: ${upload.filename} (${upload.bytes_total} bytes) for user: ${upload.user_id}`);

    // Update upload status to processing
    await updateUploadStatus(job.upload_id, 'processing', null, null);

    // Download and combine chunks from storage
    console.log('📥 Downloading CSV chunks from storage...');
    const csvData = await downloadChunksAsStream(job.upload_id, upload.filename);

    // Sanitize CSV data
    const sanitizedData = sanitizeCSVData(csvData);
    console.log(`🧹 Sanitized CSV data (${sanitizedData.length} characters)`);

    // Parse CSV using Papa Parse (same as existing logic)
    console.log('📊 Parsing CSV data...');
    const parseResult = Papa.parse(sanitizedData, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim()
    });

    if (parseResult.errors.length > 0) {
      console.warn('CSV parsing warnings:', parseResult.errors);
    }

    const rawRows = parseResult.data as any[];
    console.log(`📋 Parsed ${rawRows.length} rows from CSV`);

    // Validate and process rows
    console.log('✅ Validating and processing rows...');
    const { validRows, invalidRows, totalRows } = validateAndProcessCSVData(sanitizedData, upload.user_id);

    console.log(getValidationSummary(validRows, invalidRows, totalRows));

    if (validRows.length === 0) {
      throw new ValidationError('No valid rows found in CSV data');
    }

    // Update progress with total count
    await updateJobProgress(job.id, 'running', 0, null, true);

    // Process in batches (same logic as existing implementation)
    let processedCount = 0;
    let duplicateCount = 0;
    const totalValidRows = validRows.length;

    console.log(`🔄 Processing ${totalValidRows} valid rows in batches of ${BATCH_SIZE}`);

    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const batch = validRows.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(validRows.length / BATCH_SIZE);

      console.log(`📦 Processing batch ${batchNumber}/${totalBatches}: ${batch.length} records`);

      try {
        // Insert batch using existing RPC function
        const batchResults = await batchInsertConnections(batch);

        if (batchResults && batchResults.length > 0) {
          const { inserted_count, duplicate_count } = batchResults[0];
          processedCount += inserted_count;
          duplicateCount += duplicate_count;
        }

        // Calculate and update progress
        const progressPercentage = Math.round((processedCount + duplicateCount) * 100 / totalValidRows);
        await updateJobProgress(job.id, 'running', progressPercentage, null, true);

        console.log(`✅ Batch ${batchNumber} complete. Progress: ${processedCount + duplicateCount}/${totalValidRows} (${progressPercentage}%)`);

      } catch (batchError) {
        console.error(`❌ Batch ${batchNumber} failed:`, batchError);
        const errorMessage = batchError instanceof Error ? batchError.message : String(batchError);
        throw new WorkerError(`Batch processing failed: ${errorMessage}`, 'BATCH_ERROR', job.id, job.upload_id);
      }
    }

    // Final progress update
    await updateJobProgress(job.id, 'running', 100, null, true);

    // Update upload status to completed
    await updateUploadStatus(job.upload_id, 'completed', upload.bytes_total, null);

    // Mark job as succeeded
    await updateJobProgress(job.id, 'succeeded', 100, null, true);

    // Clean up storage chunks
    console.log('🧹 Cleaning up storage chunks...');
    await cleanupUploadChunks(job.upload_id);

    const duration = Date.now() - startTime;
    console.log(`🎉 CSV processing completed successfully in ${duration}ms`);
    console.log(`📊 Final results: ${processedCount} inserted, ${duplicateCount} duplicates, ${totalValidRows} total valid rows`);

    return {
      success: true,
      processedRecords: processedCount,
      duplicateRecords: duplicateCount,
      totalRecords: totalValidRows
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ CSV processing failed after ${duration}ms:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      // Mark upload as failed
      await updateUploadStatus(job.upload_id, 'failed', null, errorMessage);

      // Mark job as failed with retry logic
      const failureResult = await markJobFailed(job.id, errorMessage);

      if (failureResult.willRetry) {
        console.log(`🔄 Job will be retried (attempt ${failureResult.attempts})`);
      } else {
        console.log(`💀 Job failed permanently after ${failureResult.attempts} attempts`);
      }

    } catch (updateError) {
      console.error('Failed to update job/upload status after error:', updateError);
    }

    return {
      success: false,
      processedRecords: 0,
      duplicateRecords: 0,
      totalRecords: 0,
      error: errorMessage
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
    throw new ValidationError('Job missing required fields: id, upload_id');
  }

  if (job.type !== 'csv_process') {
    throw new ValidationError(`Unsupported job type: ${job.type}`);
  }

  if (job.status !== 'running') {
    throw new ValidationError(`Job status should be 'running', got: ${job.status}`);
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
  const successRate = result.totalRecords > 0 ? Math.round((total / result.totalRecords) * 100) : 0;

  return `Processing completed: ${result.processedRecords} inserted, ${result.duplicateRecords} duplicates, ${result.totalRecords} total (${successRate}% success rate)`;
}
