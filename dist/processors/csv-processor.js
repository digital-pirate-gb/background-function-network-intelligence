"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCSVJob = processCSVJob;
exports.validateJob = validateJob;
exports.getProcessingStats = getProcessingStats;
const papaparse_1 = __importDefault(require("papaparse"));
const types_1 = require("../types");
const database_1 = require("../utils/database");
const storage_1 = require("../utils/storage");
const validation_1 = require("../utils/validation");
const BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE || '1000');
const HEARTBEAT_INTERVAL = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL || '30000');
async function processCSVJob(job) {
    const startTime = Date.now();
    let heartbeatTimer = null;
    try {
        console.log(`🚀 Starting CSV processing for job ${job.id} (upload ${job.upload_id})`);
        heartbeatTimer = setInterval(async () => {
            try {
                await (0, database_1.updateJobProgress)(job.id, null, null, null, true);
            }
            catch (error) {
                console.warn('Heartbeat update failed:', error);
            }
        }, HEARTBEAT_INTERVAL);
        await (0, database_1.updateJobProgress)(job.id, 'running', 0, null, true);
        const upload = await (0, database_1.getUpload)(job.upload_id);
        console.log(`📄 Processing upload: ${upload.filename} (${upload.bytes_total} bytes) for user: ${upload.user_id}`);
        await (0, database_1.updateUploadStatus)(job.upload_id, 'processing', null, null);
        console.log('📥 Downloading CSV chunks from storage...');
        const csvData = await (0, storage_1.downloadChunksAsStream)(job.upload_id, upload.filename);
        const sanitizedData = (0, validation_1.sanitizeCSVData)(csvData);
        console.log(`🧹 Sanitized CSV data (${sanitizedData.length} characters)`);
        console.log('📊 Parsing CSV data...');
        const parseResult = papaparse_1.default.parse(sanitizedData, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim()
        });
        if (parseResult.errors.length > 0) {
            console.warn('CSV parsing warnings:', parseResult.errors);
        }
        const rawRows = parseResult.data;
        console.log(`📋 Parsed ${rawRows.length} rows from CSV`);
        console.log('✅ Validating and processing rows...');
        const { validRows, invalidRows, totalRows } = (0, validation_1.validateAndProcessCSVData)(sanitizedData, upload.user_id);
        console.log((0, validation_1.getValidationSummary)(validRows, invalidRows, totalRows));
        if (validRows.length === 0) {
            throw new types_1.ValidationError('No valid rows found in CSV data');
        }
        await (0, database_1.updateJobProgress)(job.id, 'running', 0, null, true);
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
                const batchResults = await (0, database_1.batchInsertConnections)(batch);
                if (batchResults && batchResults.length > 0) {
                    const { inserted_count, duplicate_count } = batchResults[0];
                    processedCount += inserted_count;
                    duplicateCount += duplicate_count;
                }
                const progressPercentage = Math.round((processedCount + duplicateCount) * 100 / totalValidRows);
                await (0, database_1.updateJobProgress)(job.id, 'running', progressPercentage, null, true);
                console.log(`✅ Batch ${batchNumber} complete. Progress: ${processedCount + duplicateCount}/${totalValidRows} (${progressPercentage}%)`);
            }
            catch (batchError) {
                console.error(`❌ Batch ${batchNumber} failed:`, batchError);
                const errorMessage = batchError instanceof Error ? batchError.message : String(batchError);
                throw new types_1.WorkerError(`Batch processing failed: ${errorMessage}`, 'BATCH_ERROR', job.id, job.upload_id);
            }
        }
        await (0, database_1.updateJobProgress)(job.id, 'running', 100, null, true);
        await (0, database_1.updateUploadStatus)(job.upload_id, 'completed', upload.bytes_total, null);
        await (0, database_1.updateJobProgress)(job.id, 'succeeded', 100, null, true);
        console.log('🧹 Cleaning up storage chunks...');
        await (0, storage_1.cleanupUploadChunks)(job.upload_id);
        const duration = Date.now() - startTime;
        console.log(`🎉 CSV processing completed successfully in ${duration}ms`);
        console.log(`📊 Final results: ${processedCount} inserted, ${duplicateCount} duplicates, ${totalValidRows} total valid rows`);
        return {
            success: true,
            processedRecords: processedCount,
            duplicateRecords: duplicateCount,
            totalRecords: totalValidRows
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ CSV processing failed after ${duration}ms:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        try {
            await (0, database_1.updateUploadStatus)(job.upload_id, 'failed', null, errorMessage);
            const failureResult = await (0, database_1.markJobFailed)(job.id, errorMessage);
            if (failureResult.willRetry) {
                console.log(`🔄 Job will be retried (attempt ${failureResult.attempts})`);
            }
            else {
                console.log(`💀 Job failed permanently after ${failureResult.attempts} attempts`);
            }
        }
        catch (updateError) {
            console.error('Failed to update job/upload status after error:', updateError);
        }
        return {
            success: false,
            processedRecords: 0,
            duplicateRecords: 0,
            totalRecords: 0,
            error: errorMessage
        };
    }
    finally {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
        }
    }
}
function validateJob(job) {
    if (!job.id || !job.upload_id) {
        throw new types_1.ValidationError('Job missing required fields: id, upload_id');
    }
    if (job.type !== 'csv_process') {
        throw new types_1.ValidationError(`Unsupported job type: ${job.type}`);
    }
    if (job.status !== 'running') {
        throw new types_1.ValidationError(`Job status should be 'running', got: ${job.status}`);
    }
}
function getProcessingStats(result) {
    if (!result.success) {
        return `Processing failed: ${result.error}`;
    }
    const total = result.processedRecords + result.duplicateRecords;
    const successRate = result.totalRecords > 0 ? Math.round((total / result.totalRecords) * 100) : 0;
    return `Processing completed: ${result.processedRecords} inserted, ${result.duplicateRecords} duplicates, ${result.totalRecords} total (${successRate}% success rate)`;
}
//# sourceMappingURL=csv-processor.js.map