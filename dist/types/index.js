"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationError = exports.DatabaseError = exports.StorageError = exports.WorkerError = void 0;
class WorkerError extends Error {
    constructor(message, code, jobId, uploadId) {
        super(message);
        this.code = code;
        this.jobId = jobId;
        this.uploadId = uploadId;
        this.name = "WorkerError";
    }
}
exports.WorkerError = WorkerError;
class StorageError extends WorkerError {
    constructor(message, jobId, uploadId) {
        super(message, "STORAGE_ERROR", jobId, uploadId);
        this.name = "StorageError";
    }
}
exports.StorageError = StorageError;
class DatabaseError extends WorkerError {
    constructor(message, jobId, uploadId) {
        super(message, "DATABASE_ERROR", jobId, uploadId);
        this.name = "DatabaseError";
    }
}
exports.DatabaseError = DatabaseError;
class ValidationError extends WorkerError {
    constructor(message, jobId, uploadId) {
        super(message, "VALIDATION_ERROR", jobId, uploadId);
        this.name = "ValidationError";
    }
}
exports.ValidationError = ValidationError;
//# sourceMappingURL=index.js.map