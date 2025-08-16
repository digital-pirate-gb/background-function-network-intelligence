import Papa from "papaparse";
import {
  LinkedInConnection,
  ProcessedConnection,
  ValidationError,
  ProcessingResult,
} from "../types";
import { checkForDuplicates } from "./database";

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
  if (!row["First Name"] || !row["Last Name"]) {
    return false;
  }

  if (!row["URL"]) {
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

  return {
    Name: fullName,
    "Profile URL": row["URL"] ? row["URL"].trim() : "",
    Owner: owner.trim(),
    Email: row["Email Address"]?.trim() || null,
    Company: row["Company"]?.trim() || null,
    Title: row["Position"]?.trim() || null,
    "Connected On": row["Connected On"]?.trim() || null,
  };
}

/**
 * Validate and process CSV data with duplicate checking
 */
export async function validateAndProcessCSVData(
  csvData: string,
  owner: string
): Promise<ProcessingResult> {
  if (!csvData || csvData.trim() === "") {
    throw new ValidationError("CSV data is empty");
  }

  if (!owner || owner.trim() === "") {
    throw new ValidationError("Owner is required");
  }

  // Parse CSV using Papa Parse first to get structured data
  const parseResult = Papa.parse(csvData, {
    header: false, 
    skipEmptyLines: true,
  });

  if (parseResult.errors.length > 0) {
    console.warn("CSV parsing warnings:", parseResult.errors);
  }

  const rows = parseResult.data as string[][];

  // Find the header row using the working logic
  const { headerRow, dataStartIndex } = findHeaderRow(rows);

  console.log("Using header row:", headerRow);
  console.log("Data starts at row:", dataStartIndex);

  // Create column map
  const columnMap: Record<string, number> = {};
  headerRow.forEach((header, index) => {
    if (header) {
      columnMap[normalizeHeader(header)] = index;
    }
  });

  console.log("Column map:", columnMap);

  // Verify required columns
  const requiredColumns = ["First Name", "Last Name", "URL"];
  const missingColumns = requiredColumns.filter(
    (col) =>
      !Object.keys(columnMap).some(
        (header) => header.toLowerCase() === col.toLowerCase()
      )
  );

  if (missingColumns.length > 0) {
    throw new ValidationError(
      `Missing required columns: ${missingColumns.join(
        ", "
      )}. Found columns: ${Object.keys(columnMap).join(", ")}`
    );
  }

  // Process data rows
  const dataRows = rows.slice(dataStartIndex);
  console.log(`Processing ${dataRows.length} data rows`);

  const validRows: ProcessedConnection[] = [];
  let invalidRows = 0;

  dataRows.forEach((row, index) => {
    if (!row || row.every((cell) => !cell)) {
      console.log(`Skipping empty row at index ${index}`);
      return;
    }

    // Create row object with exact column names
    const rowObj: any = {};
    Object.entries(columnMap).forEach(([header, colIndex]) => {
      const value = row[colIndex];
      rowObj[header] = value ? normalizeHeader(value) : null;
    });

    // Validate and format
    if (validateCSVRow(rowObj)) {
      const formattedRow = formatRowForSupabase(rowObj, owner);
      validRows.push(formattedRow);
    } else {
      invalidRows++;
      console.warn(
        `Invalid row at line ${index + dataStartIndex + 1}:`,
        rowObj
      );
    }
  });

  console.log(
    `✅ Validation complete: ${validRows.length} valid, ${invalidRows} invalid from ${dataRows.length} total rows`
  );

  // Check for duplicates
  console.log("🔍 Starting duplicate check...");
  const duplicateResult = await checkForDuplicates(validRows);

  return {
    validRows,
    uniqueRows: duplicateResult.uniqueRecords,
    invalidRows,
    duplicateRows: duplicateResult.duplicateCount,
    totalRows: dataRows.length,
    duplicateCheckSuccess: duplicateResult.success,
    duplicateCheckMessage: duplicateResult.message,
  };
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
function findHeaderRow(rows: string[][]): {
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
