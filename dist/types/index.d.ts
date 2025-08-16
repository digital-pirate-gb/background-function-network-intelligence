export type UploadStatus = "pending" | "uploading" | "queued" | "processing" | "completed" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "retrying";
export type JobType = "csv_process";
export interface Upload {
    id: string;
    user_id: string;
    filename: string;
    bytes_total: number;
    bytes_uploaded: number;
    status: UploadStatus;
    storage_path?: string;
    created_at: string;
    updated_at: string;
    error?: string;
}
export interface Job {
    id: string;
    upload_id: string;
    type: JobType;
    status: JobStatus;
    attempts: number;
    last_heartbeat_at?: string;
    progress: number;
    error?: string;
    created_at: string;
    updated_at: string;
}
export interface UploadChunk {
    id: string;
    upload_id: string;
    chunk_index: number;
    size: number;
    checksum?: string;
    received_at: string;
}
export interface LinkedInConnection {
    "First Name": string;
    "Last Name": string;
    URL: string;
    "Email Address"?: string;
    Company?: string;
    Position?: string;
    "Connected On"?: string;
}
export interface ProcessedConnection {
    Name: string;
    "Profile URL": string;
    Owner: string;
    Email: string | null;
    Company: string | null;
    Title: string | null;
    "Connected On": string | null;
}
export interface BatchProcessResult {
    inserted_count: number;
    duplicate_count: number;
}
export interface WorkerConfig {
    pollInterval: number;
    batchSize: number;
    maxRetries: number;
    heartbeatInterval: number;
    storageBucket: string;
    chunkSize: number;
}
export interface JobResult {
    success: boolean;
    processedRecords: number;
    duplicateRecords: number;
    totalRecords: number;
    error?: string;
}
export interface StorageChunk {
    path: string;
    size: number;
    checksum?: string;
}
export interface ProcessingProgress {
    jobId: string;
    uploadId: string;
    totalRecords: number;
    processedRecords: number;
    duplicateRecords: number;
    percentage: number;
    status: JobStatus;
}
export declare class WorkerError extends Error {
    readonly code: string;
    readonly jobId?: string | undefined;
    readonly uploadId?: string | undefined;
    constructor(message: string, code: string, jobId?: string | undefined, uploadId?: string | undefined);
}
export declare class StorageError extends WorkerError {
    constructor(message: string, jobId?: string, uploadId?: string);
}
export declare class DatabaseError extends WorkerError {
    constructor(message: string, jobId?: string, uploadId?: string);
}
export declare class ValidationError extends WorkerError {
    constructor(message: string, jobId?: string, uploadId?: string);
}
//# sourceMappingURL=index.d.ts.map