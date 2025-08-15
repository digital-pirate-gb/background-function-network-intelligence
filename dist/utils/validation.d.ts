import { LinkedInConnection, ProcessedConnection } from '../types';
export declare function validateCSVRow(row: any): row is LinkedInConnection;
export declare function formatRowForSupabase(row: LinkedInConnection, owner: string): ProcessedConnection;
export declare function validateAndProcessCSVData(csvData: string, owner: string): {
    validRows: ProcessedConnection[];
    invalidRows: number;
    totalRows: number;
};
export declare function validateCSVFormat(csvData: string): void;
export declare function sanitizeCSVData(csvData: string): string;
export declare function getValidationSummary(validRows: ProcessedConnection[], invalidRows: number, totalRows: number): string;
//# sourceMappingURL=validation.d.ts.map