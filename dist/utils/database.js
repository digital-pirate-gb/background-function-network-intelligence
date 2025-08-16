"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNextJob = getNextJob;
exports.updateJobProgress = updateJobProgress;
exports.updateUploadStatus = updateUploadStatus;
exports.getUpload = getUpload;
exports.batchInsertConnections = batchInsertConnections;
exports.debugJobsTable = debugJobsTable;
exports.getJobStats = getJobStats;
exports.cleanupOldJobs = cleanupOldJobs;
exports.markJobFailed = markJobFailed;
exports.getUploadChunks = getUploadChunks;
const supabase_1 = require("../config/supabase");
const types_1 = require("../types");
async function getNextJob(jobType = "csv_process") {
    try {
        const { data, error } = await supabase_1.supabase.rpc("get_next_job", {
            p_job_type: jobType,
        });
        if (error) {
            throw new types_1.DatabaseError(`Failed to get next job: ${error.message}`);
        }
        if (data && data.id === null) {
            return null;
        }
        return data;
    }
    catch (error) {
        console.error("Error getting next job:", error);
        console.log("🔄 Falling back to direct job query...");
        try {
            const { data: jobs, error: queryError } = await supabase_1.supabase
                .from("jobs")
                .select("*")
                .eq("type", jobType)
                .eq("status", "queued")
                .order("created_at", { ascending: true })
                .limit(1);
            if (queryError) {
                throw new types_1.DatabaseError(`Fallback job query failed: ${queryError.message}`);
            }
            if (!jobs || jobs.length === 0) {
                console.log("📭 No queued jobs found in database");
                return null;
            }
            const job = jobs[0];
            console.log(`📋 Found queued job via direct query: ${job.id}`);
            await updateJobProgress(job.id, "running", 0, null, true);
            return job;
        }
        catch (fallbackError) {
            console.error("Fallback job query also failed:", fallbackError);
            throw error;
        }
    }
}
async function updateJobProgress(jobId, status = null, progress = null, error = null, heartbeat = true) {
    try {
        const { data, error: updateError } = await supabase_1.supabase.rpc("update_job_progress", {
            p_job_id: jobId,
            p_status: status,
            p_progress: progress,
            p_error: error,
            p_heartbeat: heartbeat,
        });
        if (updateError) {
            throw new types_1.DatabaseError(`Failed to update job progress: ${updateError.message}`, jobId);
        }
        return data;
    }
    catch (error) {
        console.error("Error updating job progress:", error);
        throw error;
    }
}
async function updateUploadStatus(uploadId, status = null, bytesUploaded = null, error = null) {
    try {
        const { data, error: updateError } = await supabase_1.supabase.rpc("update_upload_status", {
            p_upload_id: uploadId,
            p_status: status,
            p_bytes_uploaded: bytesUploaded,
            p_error: error,
        });
        if (updateError) {
            throw new types_1.DatabaseError(`Failed to update upload status: ${updateError.message}`, undefined, uploadId);
        }
        return data;
    }
    catch (error) {
        console.error("Error updating upload status:", error);
        throw error;
    }
}
async function getUpload(uploadId) {
    try {
        const { data, error } = await supabase_1.supabase
            .from("uploads")
            .select("*")
            .eq("id", uploadId)
            .single();
        if (error) {
            throw new types_1.DatabaseError(`Failed to get upload: ${error.message}`, undefined, uploadId);
        }
        return data;
    }
    catch (error) {
        console.error("Error getting upload:", error);
        throw error;
    }
}
async function batchInsertConnections(connections) {
    try {
        const { data, error } = await supabase_1.supabase.rpc("process_connections_batch", {
            records: connections,
        });
        if (error) {
            throw new types_1.DatabaseError(`Failed to insert connections batch: ${error.message}`);
        }
        return data;
    }
    catch (error) {
        console.error("Error inserting connections batch:", error);
        throw error;
    }
}
async function debugJobsTable() {
    try {
        console.log("🔍 Debugging jobs table...");
        const { data: allJobs, error } = await supabase_1.supabase
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
                console.log(`  - ${job.id}: ${job.type} | ${job.status} | ${job.attempts} attempts | ${job.created_at}`);
            });
        }
        else {
            console.log("📭 No jobs found in jobs table");
        }
        const { data: queuedJobs, error: queuedError } = await supabase_1.supabase
            .from("jobs")
            .select("*")
            .eq("type", "csv_process")
            .eq("status", "queued");
        if (!queuedError && queuedJobs) {
            console.log(`🎯 Found ${queuedJobs.length} queued csv_process jobs`);
        }
    }
    catch (error) {
        console.error("Debug jobs table error:", error);
    }
}
async function getJobStats() {
    try {
        const { data, error } = await supabase_1.supabase
            .from("jobs")
            .select("status")
            .order("status");
        if (error) {
            throw new types_1.DatabaseError(`Failed to get job stats: ${error.message}`);
        }
        const stats = {};
        data?.forEach((job) => {
            stats[job.status] = (stats[job.status] || 0) + 1;
        });
        return Object.entries(stats).map(([status, count]) => ({
            status: status,
            count,
        }));
    }
    catch (error) {
        console.error("Error getting job stats:", error);
        return [];
    }
}
async function cleanupOldJobs(daysOld = 7) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
        const { count, error } = await supabase_1.supabase
            .from("jobs")
            .delete({ count: "exact" })
            .in("status", ["succeeded", "failed"])
            .lt("updated_at", cutoffDate.toISOString());
        if (error) {
            throw new types_1.DatabaseError(`Failed to cleanup old jobs: ${error.message}`);
        }
        return count || 0;
    }
    catch (error) {
        console.error("Error cleaning up old jobs:", error);
        return 0;
    }
}
async function markJobFailed(jobId, errorMessage, maxRetries = 3) {
    try {
        const { data: job, error: getError } = await supabase_1.supabase
            .from("jobs")
            .select("attempts")
            .eq("id", jobId)
            .single();
        if (getError) {
            throw new types_1.DatabaseError(`Failed to get job for retry check: ${getError.message}`, jobId);
        }
        const attempts = job.attempts || 0;
        const newStatus = attempts < maxRetries ? "retrying" : "failed";
        await updateJobProgress(jobId, newStatus, null, errorMessage, true);
        return {
            status: newStatus,
            attempts: attempts + 1,
            willRetry: newStatus === "retrying",
        };
    }
    catch (error) {
        console.error("Error marking job as failed:", error);
        throw error;
    }
}
async function getUploadChunks(uploadId) {
    try {
        const { data, error } = await supabase_1.supabase
            .from("upload_chunks")
            .select("chunk_index, size, checksum")
            .eq("upload_id", uploadId)
            .order("chunk_index");
        if (error) {
            throw new types_1.DatabaseError(`Failed to get upload chunks: ${error.message}`, undefined, uploadId);
        }
        return data || [];
    }
    catch (error) {
        console.error("Error getting upload chunks:", error);
        throw error;
    }
}
//# sourceMappingURL=database.js.map