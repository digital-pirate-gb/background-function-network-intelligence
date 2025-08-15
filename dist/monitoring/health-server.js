"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHealthServer = createHealthServer;
exports.startHealthServer = startHealthServer;
exports.startHealthLogging = startHealthLogging;
const http_1 = __importDefault(require("http"));
const worker_state_1 = require("./worker-state");
const database_1 = require("../utils/database");
const storage_1 = require("../utils/storage");
const supabase_1 = require("../config/supabase");
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3001');
let lastDatabaseCheck = new Date();
let lastStorageCheck = new Date();
let lastJobStatsCheck = new Date();
let databaseHealthy = false;
let storageHealthy = false;
let jobStats = [];
async function performHealthChecks() {
    const now = new Date();
    if (now.getTime() - lastDatabaseCheck.getTime() > 30000) {
        try {
            await (0, supabase_1.testConnection)();
            databaseHealthy = true;
            lastDatabaseCheck = now;
        }
        catch (error) {
            console.error('Database health check failed:', error);
            databaseHealthy = false;
        }
    }
    if (now.getTime() - lastStorageCheck.getTime() > 30000) {
        try {
            storageHealthy = await (0, storage_1.testStorageConnection)();
            lastStorageCheck = now;
        }
        catch (error) {
            console.error('Storage health check failed:', error);
            storageHealthy = false;
        }
    }
    if (now.getTime() - lastJobStatsCheck.getTime() > 60000) {
        try {
            jobStats = await (0, database_1.getJobStats)();
            lastJobStatsCheck = now;
        }
        catch (error) {
            console.error('Job stats check failed:', error);
            jobStats = [];
        }
    }
    let status = 'healthy';
    if (!databaseHealthy || !storageHealthy) {
        status = 'unhealthy';
    }
    else {
        const workerHealth = (0, worker_state_1.getWorkerHealth)();
        if (workerHealth.status !== 'running') {
            status = 'degraded';
        }
    }
    return {
        status,
        timestamp: now.toISOString(),
        uptime: process.uptime(),
        worker: (0, worker_state_1.getWorkerHealth)(),
        database: {
            connected: databaseHealthy,
            lastCheck: lastDatabaseCheck.toISOString()
        },
        storage: {
            connected: storageHealthy,
            lastCheck: lastStorageCheck.toISOString()
        },
        jobs: {
            stats: jobStats,
            lastCheck: lastJobStatsCheck.toISOString()
        },
        memory: process.memoryUsage(),
        environment: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
        }
    };
}
function createHealthServer() {
    const server = http_1.default.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        if (req.method !== 'GET') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        try {
            const health = await performHealthChecks();
            const statusCode = health.status === 'healthy' ? 200 :
                health.status === 'degraded' ? 200 : 503;
            res.writeHead(statusCode);
            res.end(JSON.stringify(health, null, 2));
        }
        catch (error) {
            console.error('Health check failed:', error);
            res.writeHead(503);
            res.end(JSON.stringify({
                status: 'unhealthy',
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            }));
        }
    });
    return server;
}
function startHealthServer() {
    const server = createHealthServer();
    server.listen(HEALTH_PORT, () => {
        console.log(`🏥 Health check server running on port ${HEALTH_PORT}`);
        console.log(`📊 Health endpoint: http://localhost:${HEALTH_PORT}/`);
    });
    process.on('SIGTERM', () => {
        console.log('🛑 Shutting down health server...');
        server.close(() => {
            console.log('✅ Health server closed');
        });
    });
}
function startHealthLogging(intervalMs = 300000) {
    setInterval(async () => {
        try {
            const health = await performHealthChecks();
            console.log('🏥 Health Status:', {
                status: health.status,
                uptime: Math.round(health.uptime),
                worker: health.worker.status,
                database: health.database.connected,
                storage: health.storage.connected,
                jobsProcessed: health.worker.jobsProcessed,
                memoryUsage: `${Math.round(health.memory.heapUsed / 1024 / 1024)}MB`
            });
            if (health.jobs.stats.length > 0) {
                console.log('📊 Job Queue:', health.jobs.stats);
            }
        }
        catch (error) {
            console.error('❌ Health logging failed:', error);
        }
    }, intervalMs);
}
//# sourceMappingURL=health-server.js.map