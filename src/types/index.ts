// Database types matching the bulletproof schema
export type UploadStatus = 'pending' | 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'retrying';
export type JobType = 'csv_process';

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

// CSV processing types
export interface LinkedInConnection {
  'First Name': string;
  'Last Name': string;
  'URL': string;
  'Email Address'?: string;
  'Company'?: string;
  'Position'?: string;
  'Connected On'?: string;
}

export interface ProcessedConnection {
  Name: string;
  'Profile URL': string;
  Owner: string;
  Email: string | null;
  Company: string | null;
  Title: string | null;
  'Connected On': string | null;
}

export interface BatchProcessResult {
  inserted_count: number;
  duplicate_count: number;
}

// Worker configuration
export interface WorkerConfig {
  pollInterval: number;
  batchSize: number;
  maxRetries: number;
  heartbeatInterval: number;
  storageBucket: string;
  chunkSize: number;
}

// Job processing result
export interface JobResult {
  success: boolean;
  processedRecords: number;
  duplicateRecords: number;
  totalRecords: number;
  error?: string;
}

// Storage types
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

// Error types
export class WorkerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly jobId?: string,
    public readonly uploadId?: string
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}

export class StorageError extends WorkerError {
  constructor(message: string, jobId?: string, uploadId?: string) {
    super(message, 'STORAGE_ERROR', jobId, uploadId);
    this.name = 'StorageError';
  }
}

export class DatabaseError extends WorkerError {
  constructor(message: string, jobId?: string, uploadId?: string) {
    super(message, 'DATABASE_ERROR', jobId, uploadId);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends WorkerError {
  constructor(message: string, jobId?: string, uploadId?: string) {
    super(message, 'VALIDATION_ERROR', jobId, uploadId);
    this.name = 'ValidationError';
  }
}
