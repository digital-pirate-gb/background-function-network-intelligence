import { Readable } from "stream";
import * as Papa from "papaparse";
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
 * Validate a CSV row for LinkedIn connections
 * Adapted from existing csvValidation.js
 */
export function validateCSVRow(row: any): row is LinkedInConnection {
  if (!row || typeof row !== "object") {
    return false;
  }

  // Skip empty rows
  if (!row["First Name"] && !row["Last Name"] && !row["URL"]) {
    return false;
  }

  // Required fields for LinkedIn connections (matching existing logic)
  if (!row["First Name"] || !row["Last Name"] || !row["URL"]) {
    return false;
  }

  // Validate LinkedIn URL format
  const urlPattern = /linkedin\.com\/in\//i;
  if (!urlPattern.test(row["URL"])) {
    return false;
  }

  // Optional but should be string if present
  if (row["Email Address"] && typeof row["Email Address"] !== "string") {
    return false;
  }

  if (row["Connected On"] && typeof row["Connected On"] !== "string") {
    return false;
  }

  return true;
}

/**
 * Normalise and hash a URL for efficient storage and lookup.
 * - Converts to lowercase.
 * - Removes trailing slashes.
 * - Computes a SHA-256 hash.
 */
export function normalizeAndHashUrl(url: string): {
  normalizedUrl: string;
  hash: string;
} {
  if (!url) {
    return { normalizedUrl: "", hash: "" };
  }
  const normalized = url.toLowerCase().trim().replace(/\/$/, "");
  const hash = createHash("sha256").update(normalized).digest("hex");
  return { normalizedUrl: normalized, hash };
}

/**
 * Format a validated CSV row for Supabase insertion
 * Adapted from existing csvValidation.js
 */
export function formatRowForSupabase(
  row: LinkedInConnection,
  owner: string
): ProcessedConnection {
  // Ensure consistent spacing in name
  const firstName = (row["First Name"] || "").trim();
  const lastName = (row["Last Name"] || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  const { normalizedUrl, hash } = normalizeAndHashUrl(row["URL"]);

  return {
    Name: fullName,
    "Profile URL": normalizedUrl,
    Owner: owner.trim(),
    Email: row["Email Address"]?.trim() || null,
    Company: row["Company"]?.trim() || null,
    Title: row["Position"]?.trim() || null,
    "Connected On": row["Connected On"]?.trim() || null,
    url_hash: hash,
  };
}

/**
 * Process a batch of connections with proper error handling
 */
async function processBatch(
  batch: ProcessedConnection[],
  batchNumber: number,
  manager: BatchManager
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
 * Stream-based CSV validation and processing with proper concurrency control
 */
export async function validateAndProcessCSVStream(
  stream: Readable,
  owner: string,
  batchSize: number,
  maxConcurrency: number
): Promise<{ processed: number; duplicates: number; total: number }> {
  return new Promise((resolve, reject) => {
    let totalRows = 0;
    let validRows = 0;
    let batch: ProcessedConnection[] = [];
    let batchCounter = 0;

    const manager: BatchManager = {
      activeBatches: new Set(),
      maxConcurrency,
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
        manager
      );

      addBatchToManager(manager, batchPromise);
    };

    // Create streaming parser
    const parser = Papa.parse(Papa.NODE_STREAM_INPUT, {
      header: true,
      skipEmptyLines: true,
    });

    parser.on("data", async (row: any) => {
      totalRows++;

      if (validateCSVRow(row)) {
        validRows++;
        const formattedRow = formatRowForSupabase(row, owner);
        batch.push(formattedRow);

        // Process batch when it reaches the target size
        if (batch.length >= batchSize) {
          const batchToProcess = [...batch];
          batch = [];

          try {
            await processBatchAsync(batchToProcess);
          } catch (error) {
            console.error("Error processing batch:", error);
            // Continue processing - don't fail the entire stream
          }
        }
      }

      // Log progress periodically
      if (totalRows % 1000 === 0) {
        console.log(
          `📊 Progress: ${totalRows} rows processed, ${validRows} valid, ${manager.activeBatches.size} active batches`
        );
      }
    });

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
      console.error("CSV parsing error:", error);
      reject(new ValidationError(`CSV parsing failed: ${error.message}`));
    });

    // Start processing
    stream.pipe(parser);
  });
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
