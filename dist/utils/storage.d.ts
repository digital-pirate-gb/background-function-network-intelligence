import { StorageChunk } from '../types';
export declare function getUploadChunks(uploadId: string, filename: string): Promise<StorageChunk[]>;
export declare function downloadChunksAsStream(uploadId: string, filename: string): Promise<string>;
export declare function verifyChunksExist(uploadId: string, filename: string, expectedChunks: number): Promise<boolean>;
export declare function cleanupUploadChunks(uploadId: string): Promise<void>;
export declare function getStorageBucketInfo(): Promise<{
    name: string;
    public: boolean;
    file_size_limit?: number;
}>;
export declare function testStorageConnection(): Promise<boolean>;
//# sourceMappingURL=storage.d.ts.map