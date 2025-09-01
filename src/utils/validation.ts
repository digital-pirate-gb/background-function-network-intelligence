import { Readable } from "stream";
import * as Papa from "papaparse";
import * as fastCsv from "fast-csv";
import {
  LinkedInConnection,
  ProcessedConnection,
  ValidationError,
  ProcessingResult,
} from "../types";
import { batchInsertConnections } from "./database";
import { createHash } from "crypto";

interface BatchManager {
  activeBatches: Set<Promise<void>>;
  maxConcurrency: number;
  processedCount: number;
  duplicateCount: number;
  errorCount: number;
}

/**
 * Calculate optimal batch size based on file size
 */
function calculateOptimalBatchSize(fileSizeBytes: number): number {
  if (fileSizeBytes < 10 * 1024 * 1024) return 500; // < 10MB
  if (fileSizeBytes < 100 * 1024 * 1024) return 1000; // < 100MB
  if (fileSizeBytes < 1024 * 1024 * 1024) return 2000; // < 1GB
  return 5000; // > 1GB
}

/**
 * Calculate optimal concurrency based on file size
 */
function calculateOptimalConcurrency(fileSizeBytes: number): number {
  const cpuCores = require("os").cpus().length;
  const baseConcurrency = Math.min(cpuCores * 2, 8);

  if (fileSizeBytes > 100 * 1024 * 1024) {
    return Math.min(baseConcurrency * 1.5, 12);
  }
  return baseConcurrency;
}

/**
 * Get value from row object using case-insensitive header matching
 */
function getRowValue(row: any, expectedKey: string): any {
  // First try exact match
  if (row[expectedKey] !== undefined) {
    return row[expectedKey];
  }

  // Then try case-insensitive match
  const keys = Object.keys(row);
  const matchingKey = keys.find(
    (key) => key.toLowerCase().trim() === expectedKey.toLowerCase().trim()
  );

  return matchingKey ? row[matchingKey] : undefined;
}

/**
 * Parse LinkedIn CSV row that may have malformed headers
 */
function parseLinkedInRow(row: any): LinkedInConnection | null {
  // Handle the case where data is in __parsed_extra due to CSV parsing issues
  if (
    row["Notes:"] &&
    row.__parsed_extra &&
    Array.isArray(row.__parsed_extra)
  ) {
    const firstName = row["Notes:"]?.trim();
    const lastName = row.__parsed_extra[0]?.trim();
    const url = row.__parsed_extra[1]?.trim();
    const email = row.__parsed_extra[2]?.trim();
    const company = row.__parsed_extra[3]?.trim();
    const position = row.__parsed_extra[4]?.trim();
    const connectedOn = row.__parsed_extra[5]?.trim();

    return {
      "First Name": firstName || "",
      "Last Name": lastName || "",
      URL: url || "",
      "Email Address": email || "",
      Company: company || "",
      Position: position || "",
      "Connected On": connectedOn || "",
    };
  }

  // Handle normal CSV structure
  return {
    "First Name": getRowValue(row, "First Name") || "",
    "Last Name": getRowValue(row, "Last Name") || "",
    URL: getRowValue(row, "URL") || "",
    "Email Address": getRowValue(row, "Email Address") || "",
    Company: getRowValue(row, "Company") || "",
    Position: getRowValue(row, "Position") || "",
    "Connected On": getRowValue(row, "Connected On") || "",
  };
}

// Global counter to limit debug output

/**
 * Validate a CSV row for LinkedIn connections
 * Adapted from existing csvValidation.js
 */
export function validateCSVRow(row: any): row is LinkedInConnection {
  if (!row || typeof row !== "object") {
    return false;
  }

  // Parse the row to get LinkedIn connection data
  const parsedRow = parseLinkedInRow(row);
  if (!parsedRow) {
    return false;
  }

  const {
    "First Name": firstName,
    "Last Name": lastName,
    URL: url,
  } = parsedRow;

  // Skip empty rows
  if (!firstName && !lastName && !url) {
    return false;
  }

  // Required fields for LinkedIn connections
  if (!firstName || !lastName || !url) {
    return false;
  }

  // Validate LinkedIn URL format
  const urlPattern = /linkedin\.com\/in\//i;
  if (!urlPattern.test(url)) {
    return false;
  }

  // Update the original row object to have the correct structure
  Object.assign(row, parsedRow);

  return true;
}

/**
 * Normalise and hash a URL for efficient storage and lookup.
 * - Converts to lowercase.
 * - Removes trailing slashes.
 * - Computes a SHA-256 hash.
 * - Uses job-scoped caching for performance.
 */
export function normalizeAndHashUrl(
  url: string,
  hashCache?: Map<string, string>
): {
  normalizedUrl: string;
  hash: string;
} {
  if (!url) {
    return { normalizedUrl: "", hash: "" };
  }
  const normalized = url.toLowerCase().trim().replace(/\/$/, "");

  // Use cache if provided
  if (hashCache && hashCache.has(normalized)) {
    return { normalizedUrl: normalized, hash: hashCache.get(normalized)! };
  }

  // Compute hash
  const hash = createHash("sha256").update(normalized).digest("hex");

  // Cache if provided
  if (hashCache) {
    hashCache.set(normalized, hash);
  }

  return { normalizedUrl: normalized, hash };
}

/**
 * Format a validated CSV row for Supabase insertion
 * Adapted from existing csvValidation.js
 */
export function formatRowForSupabase(
  row: any,
  owner: string,
  hashCache?: Map<string, string>
): ProcessedConnection {
  // Get values using flexible header matching
  const firstName = getRowValue(row, "First Name");
  const lastName = getRowValue(row, "Last Name");
  const url = getRowValue(row, "URL");
  const emailAddress = getRowValue(row, "Email Address");
  const company = getRowValue(row, "Company");
  const position = getRowValue(row, "Position");
  const connectedOn = getRowValue(row, "Connected On");

  // Ensure consistent spacing in name
  const firstNameTrimmed = (firstName || "").trim();
  const lastNameTrimmed = (lastName || "").trim();
  const fullName = [firstNameTrimmed, lastNameTrimmed]
    .filter(Boolean)
    .join(" ");

  const { normalizedUrl, hash } = normalizeAndHashUrl(url, hashCache);

  return {
    Name: fullName,
    "Profile URL": normalizedUrl,
    Owner: owner.trim(),
    Email: emailAddress?.trim() || null,
    Company: company?.trim() || null,
    Title: position?.trim() || null,
    "Connected On": connectedOn?.trim() || null,
    url_hash: hash,
  };
}

/**
 * Process a batch of connections with proper error handling
 */
async function processBatch(
  batch: ProcessedConnection[],
  batchNumber: number,
  manager: BatchManager,
  onProgress?: (progress: number) => Promise<void>,
  estimatedTotalBatches?: number
): Promise<void> {
  if (batch.length === 0) return;

  try {
    console.log(`📦 Processing batch ${batchNumber}: ${batch.length} records`);

    const results = await batchInsertConnections(batch);

    if (results && results.length > 0) {
      const result = results[0];
      manager.processedCount += result.inserted_count || 0;
      manager.duplicateCount += result.duplicate_count || 0;

      console.log(
        `✅ Batch ${batchNumber} complete: ${result.inserted_count} inserted, ${result.duplicate_count} duplicates`
      );
    }

    // Update progress (debounced to avoid too many DB calls)
    if (onProgress && estimatedTotalBatches) {
      const PROGRESS_UPDATE_INTERVAL = 10; // Update every 10 batches (optimized from 5)
      if (batchNumber % PROGRESS_UPDATE_INTERVAL === 0) {
        // Ensure progress stays within 10-90% range during processing
        const progress = Math.min(
          Math.max(
            Math.floor((batchNumber / estimatedTotalBatches) * 80) + 10,
            10
          ),
          90
        );
        // Fire and forget - don't wait for progress update
        onProgress(progress).catch((err) =>
          console.warn("Progress update failed:", err)
        );
      }
    }
  } catch (error) {
    manager.errorCount += batch.length;
    console.error(`❌ Batch ${batchNumber} failed:`, error);

    // Don't throw - continue processing other batches
    // In production, you might want to implement retry logic here
  }
}

/**
 * Wait for a batch slot to become available
 */
async function waitForBatchSlot(manager: BatchManager): Promise<void> {
  while (manager.activeBatches.size >= manager.maxConcurrency) {
    // Wait for any batch to complete
    await Promise.race(Array.from(manager.activeBatches));
  }
}

/**
 * Add a batch promise to the manager and handle its completion
 */
function addBatchToManager(
  manager: BatchManager,
  batchPromise: Promise<void>
): void {
  manager.activeBatches.add(batchPromise);

  batchPromise.finally(() => {
    manager.activeBatches.delete(batchPromise);
  });
}

/**
 * Preprocess CSV stream to skip notes section and find proper headers
 */
async function preprocessCSVStream(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let csvData = "";

    stream.on("data", (chunk) => {
      csvData += chunk.toString();
    });

    stream.on("end", () => {
      try {
        // Split into lines
        const lines = csvData.split("\n");
        let headerRowIndex = -1;

        // Find the actual header row (skip notes section)
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          // Skip empty lines
          if (!line) continue;

          // Skip notes section
          if (
            line.toLowerCase().includes("notes:") ||
            line.toLowerCase().includes("when exporting your connection data")
          ) {
            console.log(
              `🔍 Skipping notes line ${i + 1}: ${line.substring(0, 50)}...`
            );
            continue;
          }

          // Check if this looks like a header row
          const lowerLine = line.toLowerCase();
          if (
            lowerLine.includes("first name") &&
            lowerLine.includes("last name") &&
            lowerLine.includes("url")
          ) {
            headerRowIndex = i;
            console.log(`✅ Found header row at line ${i + 1}: ${line}`);
            break;
          }
        }

        if (headerRowIndex === -1) {
          reject(
            new ValidationError("Could not find valid header row in CSV file")
          );
          return;
        }

        // Return CSV data starting from the header row
        const processedCSV = lines.slice(headerRowIndex).join("\n");
        console.log(
          `📝 Preprocessed CSV: skipped ${headerRowIndex} lines, processing ${
            lines.length - headerRowIndex
          } lines`
        );
        resolve(processedCSV);
      } catch (error) {
        reject(error);
      }
    });

    stream.on("error", reject);
  });
}

/**
 * Stream-based CSV validation and processing with proper concurrency control
 * Optimized with Phase 1 & 2 improvements: hash caching, dynamic batch sizing, fast-csv parser
 */
export async function validateAndProcessCSVStream(
  stream: Readable,
  owner: string,
  batchSize: number,
  maxConcurrency: number,
  onProgress?: (progress: number) => Promise<void>,
  fileSizeBytes?: number
): Promise<{ processed: number; duplicates: number; total: number }> {
  try {
    // Phase 1 Optimization: Dynamic batch sizing based on file size
    const optimizedBatchSize = fileSizeBytes
      ? calculateOptimalBatchSize(fileSizeBytes)
      : batchSize;
    const optimizedConcurrency = fileSizeBytes
      ? calculateOptimalConcurrency(fileSizeBytes)
      : maxConcurrency;

    console.log(
      `🚀 Phase 1 & 2 Optimizations: batchSize=${optimizedBatchSize}, concurrency=${optimizedConcurrency}, parser=fast-csv`
    );

    // Create job-scoped hash cache for performance
    const jobHashCache = new Map<string, string>();

    // Phase 2 Optimization: Use fast-csv for better performance
    // First, preprocess the CSV to skip notes section and find proper headers
    console.log("🔍 Preprocessing CSV to find proper headers...");
    const preprocessedCSV = await preprocessCSVStream(stream);

    // Create a new readable stream from the preprocessed data
    const { Readable } = await import("stream");
    const preprocessedStream = Readable.from([preprocessedCSV]);

    return new Promise((resolve, reject) => {
      let totalRows = 0;
      let validRows = 0;
      let batch: ProcessedConnection[] = [];
      let batchCounter = 0;
      let headerLogged = false;

      // Estimate total batches based on file size and optimized batch size
      const estimatedRows = Math.ceil(preprocessedCSV.length / 200); // Rough estimate: ~200 chars per row
      const estimatedTotalBatches = Math.max(
        Math.ceil(estimatedRows / optimizedBatchSize),
        1
      ); // Ensure at least 1 batch
      console.log(
        `📊 Estimated ${estimatedRows} rows, ${estimatedTotalBatches} batches (optimized batch size: ${optimizedBatchSize})`
      );

      // Initial progress update (0-10%)
      if (onProgress) {
        onProgress(10).catch((err) =>
          console.warn("Initial progress update failed:", err)
        );
      }

      const manager: BatchManager = {
        activeBatches: new Set(),
        maxConcurrency: optimizedConcurrency,
        processedCount: 0,
        duplicateCount: 0,
        errorCount: 0,
      };

      const processBatchAsync = async (
        batchToProcess: ProcessedConnection[]
      ): Promise<void> => {
        await waitForBatchSlot(manager);

        const currentBatchNumber = ++batchCounter;
        const batchPromise = processBatch(
          batchToProcess,
          currentBatchNumber,
          manager,
          onProgress,
          estimatedTotalBatches
        );

        addBatchToManager(manager, batchPromise);
      };

      // Phase 2 Optimization: Use fast-csv parser for better performance
      const parser = fastCsv.parse({
        headers: true,
        maxRows: 0, // No limit
        strictColumnHandling: false,
        ignoreEmpty: true,
      });

      parser.on("data", async (row: any) => {
        totalRows++;

        // Log headers for debugging on first row
        if (!headerLogged) {
          headerLogged = true;
        }

        if (validateCSVRow(row)) {
          validRows++;
          const formattedRow = formatRowForSupabase(row, owner, jobHashCache);
          batch.push(formattedRow);

          // Process batch when it reaches the optimized target size
          if (batch.length >= optimizedBatchSize) {
            const batchToProcess = [...batch];
            batch = [];

            try {
              await processBatchAsync(batchToProcess);
            } catch (error) {
              console.error("Error processing batch:", error);

            }
          }
        }

        // Log progress periodically
        if (totalRows % 1000 === 0) {
          console.log(
            `📊 Progress: ${totalRows} rows processed, ${validRows} valid, ${manager.activeBatches.size} active batches`
          );
        }      });

      parser.on("end", async () => {
        try {
          // Process any remaining batch
          if (batch.length > 0) {
            await processBatchAsync([...batch]);
          }

          // Wait for all remaining batches to complete
          console.log(
            `⏳ Waiting for ${manager.activeBatches.size} remaining batches to complete...`
          );
          await Promise.all(Array.from(manager.activeBatches));

          // Final progress update (90-100%)
          if (onProgress) {
            onProgress(90).catch((err) =>
              console.warn("Final progress update failed:", err)
            );
          }

          console.log(
            `🎉 Stream processing complete: ${totalRows} total rows, ${validRows} valid rows`
          );
          console.log(
            `📊 Final results: ${manager.processedCount} inserted, ${manager.duplicateCount} duplicates, ${manager.errorCount} errors`
          );

          resolve({
            processed: manager.processedCount,
            duplicates: manager.duplicateCount,
            total: validRows,
          });
        } catch (error) {
          reject(error);
        }
      });

      parser.on("error", (error: any) => {
        console.error("Fast-CSV parsing error:", error);
        console.log("🔄 Falling back to PapaParse parser...");

        // Fallback to PapaParse if fast-csv fails
        try {
          const fallbackParser = Papa.parse(Papa.NODE_STREAM_INPUT, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header: string) => {
              return header.trim().replace(/^\uFEFF/, "");
            },
          });

          // Re-pipe the stream to fallback parser
          preprocessedStream.pipe(fallbackParser);

          fallbackParser.on("data", async (row: any) => {
            // Same processing logic as above
            totalRows++;
            if (!headerLogged) {
              headerLogged = true;
            }
            if (validateCSVRow(row)) {
              validRows++;
              const formattedRow = formatRowForSupabase(
                row,
                owner,
                jobHashCache
              );
              batch.push(formattedRow);
              if (batch.length >= optimizedBatchSize) {
                const batchToProcess = [...batch];
                batch = [];
                try {
                  await processBatchAsync(batchToProcess);
                } catch (batchError) {
                  console.error("Error processing batch:", batchError);
                }
              }
            }
            if (totalRows % 1000 === 0) {
              console.log(
                `📊 Progress: ${totalRows} rows processed, ${validRows} valid, ${manager.activeBatches.size} active batches`
              );
            }
          });

          fallbackParser.on("end", async () => {
            // Same end logic as above
            try {
              if (batch.length > 0) {
                await processBatchAsync([...batch]);
              }
              await Promise.all(Array.from(manager.activeBatches));
              if (onProgress) {
                onProgress(90).catch((err) =>
                  console.warn("Final progress update failed:", err)
                );
              }
              console.log(
                `🎉 Stream processing complete: ${totalRows} total rows, ${validRows} valid rows`
              );
              console.log(
                `📊 Final results: ${manager.processedCount} inserted, ${manager.duplicateCount} duplicates, ${manager.errorCount} errors`
              );
              resolve({
                processed: manager.processedCount,
                duplicates: manager.duplicateCount,
                total: validRows,
              });
            } catch (endError) {
              reject(endError);
            }
          });

          fallbackParser.on("error", (fallbackError: any) => {
            console.error("PapaParse fallback also failed:", fallbackError);
            reject(
              new ValidationError(
                `CSV parsing failed with both parsers: ${error.message}`
              )
            );
          });
        } catch (fallbackSetupError) {
          console.error("Failed to setup fallback parser:", fallbackSetupError);
          reject(new ValidationError(`CSV parsing failed: ${error.message}`));
        }
      });

      // Start processing the preprocessed stream
      preprocessedStream.pipe(parser);
    });
  } catch (error) {
    throw new ValidationError(
      `CSV preprocessing failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Helper function to normalize header text (from working implementation)
 */
function normalizeHeader(header: string): string {
  if (!header) return "";
  // Remove any quotes and trim whitespace
  return header.replace(/["']/g, "").trim();
}

/**
 * Helper function to split joined headers (from working implementation)
 */
function splitJoinedHeaders(text: string): string[] {
  // Common patterns in LinkedIn CSV headers
  const patterns = [
    "First Name",
    "Last Name",
    "URL",
    "Email Address",
    "Company",
    "Position",
    "Connected On",
  ];

  let result = text;
  patterns.forEach((pattern) => {
    // Create a regex that matches the pattern case-insensitive
    const regex = new RegExp(pattern, "i");
    const match = result.match(regex);
    if (match) {
      // Replace the matched text with the pattern and a comma
      result = result.replace(match[0], `${pattern},`);
    }
  });

  // Remove trailing comma and split
  return result
    .replace(/,$/, "")
    .split(",")
    .map((h) => h.trim());
}

/**
 * Helper function to validate header row (from working implementation)
 */
function isValidHeaderRow(row: string[] | any): boolean {
  if (!row) return false;

  // If it's a string (joined headers), try to split it
  const headers = Array.isArray(row)
    ? row.map(normalizeHeader)
    : splitJoinedHeaders(normalizeHeader(String(row)));

  console.log("Normalized headers:", headers);

  // Check for required columns using case-insensitive comparison
  const requiredColumns = ["First Name", "Last Name", "URL"];
  const hasAllRequired = requiredColumns.every((required) =>
    headers.some((header) => header.toLowerCase() === required.toLowerCase())
  );

  console.log("Has all required columns:", hasAllRequired);
  return hasAllRequired;
}

/**
 * Find header row in CSV data (from working implementation)
 */
export function findHeaderRow(rows: string[][]): {
  headerRow: string[];
  dataStartIndex: number;
} {
  console.log("Searching for header row...");

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    // Convert row to string if it's an array
    const rowText = Array.isArray(row) ? row.join(" ") : String(row);

    // Skip notes section
    if (
      rowText.toLowerCase().includes("notes:") ||
      rowText.toLowerCase().includes("when exporting your connection data")
    ) {
      continue;
    }

    // Try to find header row
    console.log(`Checking row ${i + 1}:`, rowText);

    if (isValidHeaderRow(row)) {
      console.log(`Found valid header row at position ${i + 1}`);
      return {
        headerRow: Array.isArray(row) ? row : splitJoinedHeaders(String(row)),
        dataStartIndex: i + 1,
      };
    }
  }

  throw new ValidationError("No valid header row found in the CSV file");
}

/**
 * Validate file format and basic structure
 */
export function validateCSVFormat(csvData: string): void {
  if (!csvData || csvData.trim() === "") {
    throw new ValidationError("CSV data is empty");
  }

  // Check for basic CSV structure
  const lines = csvData.split("\n").filter((line) => line.trim() !== "");

  if (lines.length < 2) {
    throw new ValidationError(
      "CSV must have at least a header and one data row"
    );
  }

  // Check if first line looks like a header
  const firstLine = lines[0];
  if (!firstLine.includes(",")) {
    throw new ValidationError("CSV must be comma-separated");
  }

  // Basic validation for LinkedIn export format
  const headerLower = firstLine.toLowerCase();
  const expectedFields = ["first name", "last name", "company"];
  const hasExpectedFields = expectedFields.some((field) =>
    headerLower.includes(field)
  );

  if (!hasExpectedFields) {
    throw new ValidationError(
      "CSV does not appear to be a LinkedIn connections export"
    );
  }
}

/**
 * Sanitize and clean CSV data
 */
export function sanitizeCSVData(csvData: string): string {
  // Remove BOM if present
  if (csvData.charCodeAt(0) === 0xfeff) {
    csvData = csvData.slice(1);
  }

  // Normalize line endings
  csvData = csvData.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Remove empty lines at the end
  csvData = csvData.replace(/\n+$/, "");

  return csvData;
}

/**
 * Get validation summary with duplicate information
 */
export function getValidationSummary(result: ProcessingResult): string {
  const validCount = result.validRows.length;
  const uniqueCount = result.uniqueRows.length;
  const totalCount = result.totalRows;
  const validPercentage =
    totalCount > 0 ? Math.round((validCount / totalCount) * 100) : 0;

  let summary = `Validation complete: ${validCount}/${totalCount} rows valid (${validPercentage}%), ${result.invalidRows} invalid rows`;

  if (result.duplicateCheckSuccess) {
    summary += `\n🔍 Duplicate check: ${uniqueCount} unique records, ${result.duplicateRows} duplicates found`;
    summary += `\n📝 ${result.duplicateCheckMessage}`;
  } else {
    summary += `\n⚠️ Duplicate check failed: ${result.duplicateCheckMessage}`;
  }

  return summary;
}

export function normalizeHeaders(headers: string[]): string[] {
  return (headers || []).map((h) =>
    (h || "")
      .replace(/^\uFEFF/, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
  );
}

export function prettyName(name: string): string {
  return name
    .split(" ")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export function validateRequiredColumns(rawHeaders: string[]): void {
  const headers = normalizeHeaders(rawHeaders || []);
  const headerSet = new Set(headers);
  const expectedColumns = ["first name", "last name", "url"];
  const missing = expectedColumns.filter((c) => !headerSet.has(c));
  if (missing.length) {
    // ValidationError is defined in this module elsewhere
    throw new ValidationError(
      `Missing required columns: ${missing.map(prettyName).join(", ")}`
    );
  }
}
