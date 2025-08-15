"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUploadChunks = getUploadChunks;
exports.downloadChunksAsStream = downloadChunksAsStream;
exports.verifyChunksExist = verifyChunksExist;
exports.cleanupUploadChunks = cleanupUploadChunks;
exports.getStorageBucketInfo = getStorageBucketInfo;
exports.testStorageConnection = testStorageConnection;
const supabase_1 = require("../config/supabase");
const types_1 = require("../types");
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'csv-uploads';
async function getUploadChunks(uploadId, filename) {
    try {
        const { data, error } = await supabase_1.supabase.storage
            .from(STORAGE_BUCKET)
            .list(uploadId);
        if (error) {
            throw new types_1.StorageError(`Failed to list upload chunks: ${error.message}`, undefined, uploadId);
        }
        if (!data || data.length === 0) {
            throw new types_1.StorageError(`No chunks found for upload ${uploadId}`, undefined, uploadId);
        }
        const chunks = data
            .filter(file => file.name.startsWith(filename))
            .map(file => ({
            path: `${uploadId}/${file.name}`,
            size: file.metadata?.size || 0,
            checksum: file.metadata?.checksum
        }))
            .sort((a, b) => {
            const aIndex = parseInt(a.path.split('.part')[1] || '0');
            const bIndex = parseInt(b.path.split('.part')[1] || '0');
            return aIndex - bIndex;
        });
        return chunks;
    }
    catch (error) {
        console.error('Error getting upload chunks:', error);
        throw error;
    }
}
async function downloadChunksAsStream(uploadId, filename) {
    try {
        const chunks = await getUploadChunks(uploadId, filename);
        let combinedData = '';
        console.log(`📥 Downloading ${chunks.length} chunks for upload ${uploadId}`);
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`📄 Downloading chunk ${i + 1}/${chunks.length}: ${chunk.path}`);
            const { data, error } = await supabase_1.supabase.storage
                .from(STORAGE_BUCKET)
                .download(chunk.path);
            if (error) {
                throw new types_1.StorageError(`Failed to download chunk ${chunk.path}: ${error.message}`, undefined, uploadId);
            }
            if (!data) {
                throw new types_1.StorageError(`No data received for chunk ${chunk.path}`, undefined, uploadId);
            }
            const chunkText = await data.text();
            combinedData += chunkText;
        }
        console.log(`✅ Successfully combined ${chunks.length} chunks (${combinedData.length} characters)`);
        return combinedData;
    }
    catch (error) {
        console.error('Error downloading chunks as stream:', error);
        throw error;
    }
}
async function verifyChunksExist(uploadId, filename, expectedChunks) {
    try {
        const chunks = await getUploadChunks(uploadId, filename);
        if (chunks.length !== expectedChunks) {
            console.warn(`Expected ${expectedChunks} chunks, found ${chunks.length}`);
            return false;
        }
        for (let i = 0; i < expectedChunks; i++) {
            const expectedPath = `${uploadId}/${filename}.part${i}`;
            const chunkExists = chunks.some(chunk => chunk.path === expectedPath);
            if (!chunkExists) {
                console.warn(`Missing chunk: ${expectedPath}`);
                return false;
            }
        }
        return true;
    }
    catch (error) {
        console.error('Error verifying chunks:', error);
        return false;
    }
}
async function cleanupUploadChunks(uploadId) {
    try {
        const { data, error } = await supabase_1.supabase.storage
            .from(STORAGE_BUCKET)
            .list(uploadId);
        if (error) {
            console.error('Error listing files for cleanup:', error);
            return;
        }
        if (data && data.length > 0) {
            const filesToDelete = data.map(file => `${uploadId}/${file.name}`);
            console.log(`🧹 Cleaning up ${filesToDelete.length} chunks for upload ${uploadId}`);
            const { error: deleteError } = await supabase_1.supabase.storage
                .from(STORAGE_BUCKET)
                .remove(filesToDelete);
            if (deleteError) {
                console.error('Error cleaning up chunks:', deleteError);
            }
            else {
                console.log(`✅ Successfully cleaned up chunks for upload ${uploadId}`);
            }
        }
    }
    catch (error) {
        console.error('Error during cleanup:', error);
    }
}
async function getStorageBucketInfo() {
    try {
        const { data: buckets, error } = await supabase_1.supabase.storage.listBuckets();
        if (error) {
            throw new types_1.StorageError(`Failed to list buckets: ${error.message}`);
        }
        const bucket = buckets.find(b => b.name === STORAGE_BUCKET);
        if (!bucket) {
            throw new types_1.StorageError(`Storage bucket '${STORAGE_BUCKET}' not found`);
        }
        return bucket;
    }
    catch (error) {
        console.error('Error getting storage bucket info:', error);
        throw error;
    }
}
async function testStorageConnection() {
    try {
        await getStorageBucketInfo();
        console.log('✅ Storage connection test passed');
        return true;
    }
    catch (error) {
        console.error('❌ Storage connection test failed:', error);
        return false;
    }
}
//# sourceMappingURL=storage.js.map