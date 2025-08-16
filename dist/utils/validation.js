"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCSVRow = validateCSVRow;
exports.formatRowForSupabase = formatRowForSupabase;
exports.validateAndProcessCSVData = validateAndProcessCSVData;
exports.validateCSVFormat = validateCSVFormat;
exports.sanitizeCSVData = sanitizeCSVData;
exports.getValidationSummary = getValidationSummary;
exports.normalizeHeaders = normalizeHeaders;
exports.prettyName = prettyName;
exports.validateRequiredColumns = validateRequiredColumns;
const papaparse_1 = __importDefault(require("papaparse"));
const types_1 = require("../types");
function validateCSVRow(row) {
    if (!row || typeof row !== "object") {
        return false;
    }
    if (!row["First Name"] && !row["Last Name"] && !row["URL"]) {
        return false;
    }
    if (!row["First Name"] || !row["Last Name"]) {
        return false;
    }
    if (!row["URL"]) {
        return false;
    }
    const urlPattern = /linkedin\.com\/in\//i;
    if (!urlPattern.test(row["URL"])) {
        return false;
    }
    if (row["Email Address"] && typeof row["Email Address"] !== "string") {
        return false;
    }
    if (row["Connected On"] && typeof row["Connected On"] !== "string") {
        return false;
    }
    return true;
}
function formatRowForSupabase(row, owner) {
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
function validateAndProcessCSVData(csvData, owner) {
    if (!csvData || csvData.trim() === "") {
        throw new types_1.ValidationError("CSV data is empty");
    }
    if (!owner || owner.trim() === "") {
        throw new types_1.ValidationError("Owner is required");
    }
    const parseResult = papaparse_1.default.parse(csvData, {
        header: false,
        skipEmptyLines: true,
    });
    if (parseResult.errors.length > 0) {
        console.warn("CSV parsing warnings:", parseResult.errors);
    }
    const rows = parseResult.data;
    const { headerRow, dataStartIndex } = findHeaderRow(rows);
    console.log("Using header row:", headerRow);
    console.log("Data starts at row:", dataStartIndex);
    const columnMap = {};
    headerRow.forEach((header, index) => {
        if (header) {
            columnMap[normalizeHeader(header)] = index;
        }
    });
    console.log("Column map:", columnMap);
    const requiredColumns = ["First Name", "Last Name", "URL"];
    const missingColumns = requiredColumns.filter((col) => !Object.keys(columnMap).some((header) => header.toLowerCase() === col.toLowerCase()));
    if (missingColumns.length > 0) {
        throw new types_1.ValidationError(`Missing required columns: ${missingColumns.join(", ")}. Found columns: ${Object.keys(columnMap).join(", ")}`);
    }
    const dataRows = rows.slice(dataStartIndex);
    console.log(`Processing ${dataRows.length} data rows`);
    const validRows = [];
    let invalidRows = 0;
    dataRows.forEach((row, index) => {
        if (!row || row.every((cell) => !cell)) {
            console.log(`Skipping empty row at index ${index}`);
            return;
        }
        const rowObj = {};
        Object.entries(columnMap).forEach(([header, colIndex]) => {
            const value = row[colIndex];
            rowObj[header] = value ? normalizeHeader(value) : null;
        });
        if (validateCSVRow(rowObj)) {
            const formattedRow = formatRowForSupabase(rowObj, owner);
            validRows.push(formattedRow);
        }
        else {
            invalidRows++;
            console.warn(`Invalid row at line ${index + dataStartIndex + 1}:`, rowObj);
        }
    });
    return {
        validRows,
        invalidRows,
        totalRows: dataRows.length,
    };
}
function normalizeHeader(header) {
    if (!header)
        return "";
    return header.replace(/["']/g, "").trim();
}
function splitJoinedHeaders(text) {
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
        const regex = new RegExp(pattern, "i");
        const match = result.match(regex);
        if (match) {
            result = result.replace(match[0], `${pattern},`);
        }
    });
    return result
        .replace(/,$/, "")
        .split(",")
        .map((h) => h.trim());
}
function isValidHeaderRow(row) {
    if (!row)
        return false;
    const headers = Array.isArray(row)
        ? row.map(normalizeHeader)
        : splitJoinedHeaders(normalizeHeader(String(row)));
    console.log("Normalized headers:", headers);
    const requiredColumns = ["First Name", "Last Name", "URL"];
    const hasAllRequired = requiredColumns.every((required) => headers.some((header) => header.toLowerCase() === required.toLowerCase()));
    console.log("Has all required columns:", hasAllRequired);
    return hasAllRequired;
}
function findHeaderRow(rows) {
    console.log("Searching for header row...");
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.length)
            continue;
        const rowText = Array.isArray(row) ? row.join(" ") : String(row);
        if (rowText.toLowerCase().includes("notes:") ||
            rowText.toLowerCase().includes("when exporting your connection data")) {
            continue;
        }
        console.log(`Checking row ${i + 1}:`, rowText);
        if (isValidHeaderRow(row)) {
            console.log(`Found valid header row at position ${i + 1}`);
            return {
                headerRow: Array.isArray(row) ? row : splitJoinedHeaders(String(row)),
                dataStartIndex: i + 1,
            };
        }
    }
    throw new types_1.ValidationError("No valid header row found in the CSV file");
}
function validateCSVFormat(csvData) {
    if (!csvData || csvData.trim() === "") {
        throw new types_1.ValidationError("CSV data is empty");
    }
    const lines = csvData.split("\n").filter((line) => line.trim() !== "");
    if (lines.length < 2) {
        throw new types_1.ValidationError("CSV must have at least a header and one data row");
    }
    const firstLine = lines[0];
    if (!firstLine.includes(",")) {
        throw new types_1.ValidationError("CSV must be comma-separated");
    }
    const headerLower = firstLine.toLowerCase();
    const expectedFields = ["first name", "last name", "company"];
    const hasExpectedFields = expectedFields.some((field) => headerLower.includes(field));
    if (!hasExpectedFields) {
        throw new types_1.ValidationError("CSV does not appear to be a LinkedIn connections export");
    }
}
function sanitizeCSVData(csvData) {
    if (csvData.charCodeAt(0) === 0xfeff) {
        csvData = csvData.slice(1);
    }
    csvData = csvData.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    csvData = csvData.replace(/\n+$/, "");
    return csvData;
}
function getValidationSummary(validRows, invalidRows, totalRows) {
    const validCount = validRows.length;
    const validPercentage = totalRows > 0 ? Math.round((validCount / totalRows) * 100) : 0;
    return `Validation complete: ${validCount}/${totalRows} rows valid (${validPercentage}%), ${invalidRows} invalid rows`;
}
function normalizeHeaders(headers) {
    return (headers || []).map((h) => (h || "")
        .replace(/^\uFEFF/, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase());
}
function prettyName(name) {
    return name
        .split(" ")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
}
function validateRequiredColumns(rawHeaders) {
    const headers = normalizeHeaders(rawHeaders || []);
    const headerSet = new Set(headers);
    const expectedColumns = ["first name", "last name", "url"];
    const missing = expectedColumns.filter((c) => !headerSet.has(c));
    if (missing.length) {
        throw new types_1.ValidationError(`Missing required columns: ${missing.map(prettyName).join(", ")}`);
    }
}
//# sourceMappingURL=validation.js.map