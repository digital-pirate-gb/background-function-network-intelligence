"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCSVRow = validateCSVRow;
exports.formatRowForSupabase = formatRowForSupabase;
exports.validateAndProcessCSVData = validateAndProcessCSVData;
exports.validateCSVFormat = validateCSVFormat;
exports.sanitizeCSVData = sanitizeCSVData;
exports.getValidationSummary = getValidationSummary;
const types_1 = require("../types");
function validateCSVRow(row) {
    if (!row || typeof row !== 'object') {
        return false;
    }
    const requiredFields = ['First Name', 'Last Name', 'Company', 'Position'];
    for (const field of requiredFields) {
        if (!row[field] || typeof row[field] !== 'string' || row[field].trim() === '') {
            return false;
        }
    }
    if (row['Email Address'] && typeof row['Email Address'] !== 'string') {
        return false;
    }
    if (row['Connected On'] && typeof row['Connected On'] !== 'string') {
        return false;
    }
    return true;
}
function formatRowForSupabase(row, owner) {
    const now = new Date().toISOString();
    return {
        first_name: row['First Name'].trim(),
        last_name: row['Last Name'].trim(),
        email: row['Email Address']?.trim() || null,
        company: row['Company'].trim(),
        position: row['Position'].trim(),
        connected_on: row['Connected On']?.trim() || '',
        owner: owner.trim(),
        created_at: now
    };
}
function validateAndProcessCSVData(csvData, owner) {
    if (!csvData || csvData.trim() === '') {
        throw new types_1.ValidationError('CSV data is empty');
    }
    if (!owner || owner.trim() === '') {
        throw new types_1.ValidationError('Owner is required');
    }
    const lines = csvData.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) {
        throw new types_1.ValidationError('CSV must have at least a header and one data row');
    }
    const header = lines[0].split(',').map(col => col.trim().replace(/"/g, ''));
    const requiredColumns = ['First Name', 'Last Name', 'Company', 'Position'];
    const missingColumns = requiredColumns.filter(col => !header.includes(col));
    if (missingColumns.length > 0) {
        throw new types_1.ValidationError(`Missing required columns: ${missingColumns.join(', ')}`);
    }
    const validRows = [];
    let invalidRows = 0;
    for (let i = 1; i < lines.length; i++) {
        try {
            const values = lines[i].split(',').map(val => val.trim().replace(/"/g, ''));
            const row = {};
            header.forEach((col, index) => {
                row[col] = values[index] || '';
            });
            if (validateCSVRow(row)) {
                const formattedRow = formatRowForSupabase(row, owner);
                validRows.push(formattedRow);
            }
            else {
                invalidRows++;
                console.warn(`Invalid row at line ${i + 1}:`, row);
            }
        }
        catch (error) {
            invalidRows++;
            console.warn(`Error processing row at line ${i + 1}:`, error);
        }
    }
    return {
        validRows,
        invalidRows,
        totalRows: lines.length - 1
    };
}
function validateCSVFormat(csvData) {
    if (!csvData || csvData.trim() === '') {
        throw new types_1.ValidationError('CSV data is empty');
    }
    const lines = csvData.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) {
        throw new types_1.ValidationError('CSV must have at least a header and one data row');
    }
    const firstLine = lines[0];
    if (!firstLine.includes(',')) {
        throw new types_1.ValidationError('CSV must be comma-separated');
    }
    const headerLower = firstLine.toLowerCase();
    const expectedFields = ['first name', 'last name', 'company'];
    const hasExpectedFields = expectedFields.some(field => headerLower.includes(field));
    if (!hasExpectedFields) {
        throw new types_1.ValidationError('CSV does not appear to be a LinkedIn connections export');
    }
}
function sanitizeCSVData(csvData) {
    if (csvData.charCodeAt(0) === 0xFEFF) {
        csvData = csvData.slice(1);
    }
    csvData = csvData.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    csvData = csvData.replace(/\n+$/, '');
    return csvData;
}
function getValidationSummary(validRows, invalidRows, totalRows) {
    const validCount = validRows.length;
    const validPercentage = totalRows > 0 ? Math.round((validCount / totalRows) * 100) : 0;
    return `Validation complete: ${validCount}/${totalRows} rows valid (${validPercentage}%), ${invalidRows} invalid rows`;
}
//# sourceMappingURL=validation.js.map