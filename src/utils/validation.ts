import {
  LinkedInConnection,
  ProcessedConnection,
  ValidationError,
} from "../types";

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
 * Validate and process CSV data
 */
export function validateAndProcessCSVData(
  csvData: string,
  owner: string
): {
  validRows: ProcessedConnection[];
  invalidRows: number;
  totalRows: number;
} {
  if (!csvData || csvData.trim() === "") {
    throw new ValidationError("CSV data is empty");
  }

  if (!owner || owner.trim() === "") {
    throw new ValidationError("Owner is required");
  }

  // Split into lines and parse manually for better error handling
  const lines = csvData.split("\n").filter((line) => line.trim() !== "");

  if (lines.length < 2) {
    throw new ValidationError(
      "CSV must have at least a header and one data row"
    );
  }

  // Parse header
  const header = lines[0].split(",").map((col) => col.trim().replace(/"/g, ""));

  // Validate required columns exist
  const requiredColumns = ["First Name", "Last Name", "Company", "Position"];
  const missingColumns = requiredColumns.filter((col) => !header.includes(col));

  if (missingColumns.length > 0) {
    throw new ValidationError(
      `Missing required columns: ${missingColumns.join(", ")}`
    );
  }

  const validRows: ProcessedConnection[] = [];
  let invalidRows = 0;

  // Process data rows
  for (let i = 1; i < lines.length; i++) {
    try {
      const values = lines[i]
        .split(",")
        .map((val) => val.trim().replace(/"/g, ""));

      // Create row object
      const row: any = {};
      header.forEach((col, index) => {
        row[col] = values[index] || "";
      });

      // Validate and format
      if (validateCSVRow(row)) {
        const formattedRow = formatRowForSupabase(row, owner);
        validRows.push(formattedRow);
      } else {
        invalidRows++;
        console.warn(`Invalid row at line ${i + 1}:`, row);
      }
    } catch (error) {
      invalidRows++;
      console.warn(`Error processing row at line ${i + 1}:`, error);
    }
  }

  return {
    validRows,
    invalidRows,
    totalRows: lines.length - 1, // Exclude header
  };
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
 * Get validation summary
 */
export function getValidationSummary(
  validRows: ProcessedConnection[],
  invalidRows: number,
  totalRows: number
): string {
  const validCount = validRows.length;
  const validPercentage =
    totalRows > 0 ? Math.round((validCount / totalRows) * 100) : 0;

  return `Validation complete: ${validCount}/${totalRows} rows valid (${validPercentage}%), ${invalidRows} invalid rows`;
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
