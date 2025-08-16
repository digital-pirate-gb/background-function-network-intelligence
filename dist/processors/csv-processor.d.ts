import { Job, JobResult } from "../types";
export declare function processCSVJob(job: Job): Promise<JobResult>;
export declare function validateJob(job: Job): void;
export declare function getProcessingStats(result: JobResult): string;
//# sourceMappingURL=csv-processor.d.ts.map