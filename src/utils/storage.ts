import { supabase } from "../config/supabase";
import { StorageError, StorageChunk } from "../types";
import { Readable } from "stream";

const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "csv-uploads";

/**
 * Get all chunks for an upload from storage
 */
export async function getUploadChunks(
  uploadId: string,
  filename: string
): Promise<StorageChunk[]> {
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(uploadId);

    if (error) {
      throw new StorageError(
        `Failed to list upload chunks: ${error.message}`,
        undefined,
        uploadId
      );
    }

    if (!data || data.length === 0) {
      throw new StorageError(
        `No chunks found for upload ${uploadId}`,
        undefined,
        uploadId
      );
    }

    // Filter and sort chunks
    const chunks = data
      .filter((file) => file.name.startsWith(filename))
      .map((file) => ({
        path: `${uploadId}/${file.name}`,
        size: file.metadata?.size || 0,
        checksum: file.metadata?.checksum,
      }))
      .sort((a, b) => {
        // Extract chunk index from filename (e.g., "file.csv.part0", "file.csv.part1")
        const aIndex = parseInt(a.path.split(".part")[1] || "0");
        const bIndex = parseInt(b.path.split(".part")[1] || "0");
        return aIndex - bIndex;
      });

    return chunks;
  } catch (error) {
    console.error("Error getting upload chunks:", error);
    throw error;
  }
}

/**
 * Download and combine chunks into a readable stream with proper backpressure
 */
export async function downloadChunksAsStream(
  uploadId: string,
  filename: string
): Promise<Readable> {
  try {
    const chunks = await getUploadChunks(uploadId, filename);

    console.log(
      `📥 Downloading ${chunks.length} chunks for upload ${uploadId}`
    );

    let currentChunkIndex = 0;
    let isReading = false;
    let streamEnded = false;

    const stream = new Readable({
      async read() {
        // Prevent concurrent reads
        if (isReading || streamEnded || currentChunkIndex >= chunks.length) {
          return;
        }

        isReading = true;

        try {
          while (currentChunkIndex < chunks.length && !streamEnded) {
            const chunk = chunks[currentChunkIndex];
            console.log(
              `📄 Downloading chunk ${currentChunkIndex + 1}/${
                chunks.length
              }: ${chunk.path}`
            );

            const { data, error } = await supabase.storage
              .from(STORAGE_BUCKET)
              .download(chunk.path);

            if (error) {
              this.emit(
                "error",
                new StorageError(
                  `Failed to download chunk ${chunk.path}: ${error.message}`,
                  undefined,
                  uploadId
                )
              );
              return;
            }

            if (!data) {
              this.emit(
                "error",
                new StorageError(
                  `No data received for chunk ${chunk.path}`,
                  undefined,
                  uploadId
                )
              );
              return;
            }

            // Convert blob to buffer in smaller chunks to manage memory
            const buffer = Buffer.from(await data.arrayBuffer());

            // Push data in smaller chunks to handle backpressure
            const CHUNK_SIZE = 64 * 1024; // 64KB chunks
            let offset = 0;

            while (offset < buffer.length && !streamEnded) {
              const end = Math.min(offset + CHUNK_SIZE, buffer.length);
              const subChunk = buffer.subarray(offset, end);

              // If push returns false, the internal buffer is full
              if (!this.push(subChunk)) {
                // Stream will call _read again when ready
                currentChunkIndex++;
                offset = end;
                isReading = false;
                return;
              }

              offset = end;
            }

            currentChunkIndex++;
          }

          // End the stream if we've processed all chunks
          if (currentChunkIndex >= chunks.length) {
            streamEnded = true;
            this.push(null);
          }
        } catch (error) {
          this.emit(
            "error",
            new StorageError(
              `Error processing chunk: ${
                error instanceof Error ? error.message : String(error)
              }`,
              undefined,
              uploadId
            )
          );
        } finally {
          isReading = false;
        }
      },
    });

    return stream;
  } catch (error) {
    console.error("Error preparing chunks for stream:", error);
    throw error;
  }
}

/**
 * Verify all chunks exist for an upload
 */
export async function verifyChunksExist(
  uploadId: string,
  filename: string,
  expectedChunks: number
): Promise<boolean> {
  try {
    const chunks = await getUploadChunks(uploadId, filename);

    if (chunks.length !== expectedChunks) {
      console.warn(`Expected ${expectedChunks} chunks, found ${chunks.length}`);
      return false;
    }

    // Verify chunk sequence is complete (0, 1, 2, ...)
    for (let i = 0; i < expectedChunks; i++) {
      const expectedPath = `${uploadId}/${filename}.part${i}`;
      const chunkExists = chunks.some((chunk) => chunk.path === expectedPath);

      if (!chunkExists) {
        console.warn(`Missing chunk: ${expectedPath}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("Error verifying chunks:", error);
    return false;
  }
}

/**
 * Clean up upload chunks after processing
 */
export async function cleanupUploadChunks(uploadId: string): Promise<void> {
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(uploadId);

    if (error) {
      console.error("Error listing files for cleanup:", error);
      return;
    }

    if (data && data.length > 0) {
      const filesToDelete = data.map((file) => `${uploadId}/${file.name}`);

      console.log(
        `🧹 Cleaning up ${filesToDelete.length} chunks for upload ${uploadId}`
      );

      const { error: deleteError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(filesToDelete);

      if (deleteError) {
        console.error("Error cleaning up chunks:", deleteError);
      } else {
        console.log(`✅ Successfully cleaned up chunks for upload ${uploadId}`);
      }
    }
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}

/**
 * Get storage bucket info
 */
export async function getStorageBucketInfo(): Promise<{
  name: string;
  public: boolean;
  file_size_limit?: number;
}> {
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      throw new StorageError(`Failed to list buckets: ${error.message}`);
    }

    const bucket = buckets.find((b) => b.name === STORAGE_BUCKET);

    if (!bucket) {
      throw new StorageError(`Storage bucket '${STORAGE_BUCKET}' not found`);
    }

    return bucket;
  } catch (error) {
    console.error("Error getting storage bucket info:", error);
    throw error;
  }
}

/**
 * Test storage connectivity
 */
export async function testStorageConnection(): Promise<boolean> {
  try {
    await getStorageBucketInfo();
    console.log("✅ Storage connection test passed");
    return true;
  } catch (error) {
    console.error("❌ Storage connection test failed:", error);
    return false;
  }
}
