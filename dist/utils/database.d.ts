import { Job, Upload, JobStatus, JobType, UploadStatus, ProcessedConnection, BatchProcessResult } from '../types';
export declare function getNextJob(jobType?: JobType): Promise<Job | null>;
export declare function updateJobProgress(jobId: string, status?: JobStatus | null, progress?: number | null, error?: string | null, heartbeat?: boolean): Promise<Job>;
export declare function updateUploadStatus(uploadId: string, status?: UploadStatus | null, bytesUploaded?: number | null, error?: string | null): Promise<Upload>;
export declare function getUpload(uploadId: string): Promise<Upload>;
export declare function batchInsertConnections(connections: ProcessedConnection[]): Promise<BatchProcessResult[]>;
export declare function getJobStats(): Promise<Array<{
    status: JobStatus;
    count: number;
}>>;
export declare function cleanupOldJobs(daysOld?: number): Promise<number>;
export declare function markJobFailed(jobId: string, errorMessage: string, maxRetries?: number): Promise<{
    status: JobStatus;
    attempts: number;
    willRetry: boolean;
}>;
export declare function getUploadChunks(uploadId: string): Promise<Array<{
    chunk_index: number;
    size: number;
    checksum?: string;
}>>;
//# sourceMappingURL=database.d.ts.map