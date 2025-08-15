import http from 'http';
import { getWorkerHealth } from './worker-state';
import { getJobStats } from '../utils/database';
import { testStorageConnection } from '../utils/storage';
import { testConnection } from '../config/supabase';

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3001');

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  worker: {
    status: string;
    isShuttingDown: boolean;
    currentJob: any;
    jobsProcessed: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    config: any;
  };
  database: {
    connected: boolean;
    lastCheck: string;
  };
  storage: {
    connected: boolean;
    lastCheck: string;
  };
  jobs: {
    stats: Array<{ status: string; count: number }>;
    lastCheck: string;
  };
  memory: NodeJS.MemoryUsage;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
}

let lastDatabaseCheck = new Date();
let lastStorageCheck = new Date();
let lastJobStatsCheck = new Date();
let databaseHealthy = false;
let storageHealthy = false;
let jobStats: Array<{ status: string; count: number }> = [];

/**
 * Perform health checks
 */
async function performHealthChecks(): Promise<HealthStatus> {
  const now = new Date();

  // Check database connection (every 30 seconds)
  if (now.getTime() - lastDatabaseCheck.getTime() > 30000) {
    try {
      await testConnection();
      databaseHealthy = true;
      lastDatabaseCheck = now;
    } catch (error) {
      console.error('Database health check failed:', error);
      databaseHealthy = false;
    }
  }

  // Check storage connection (every 30 seconds)
  if (now.getTime() - lastStorageCheck.getTime() > 30000) {
    try {
      storageHealthy = await testStorageConnection();
      lastStorageCheck = now;
    } catch (error) {
      console.error('Storage health check failed:', error);
      storageHealthy = false;
    }
  }

  // Get job statistics (every 60 seconds)
  if (now.getTime() - lastJobStatsCheck.getTime() > 60000) {
    try {
      jobStats = await getJobStats();
      lastJobStatsCheck = now;
    } catch (error) {
      console.error('Job stats check failed:', error);
      jobStats = [];
    }
  }

  // Determine overall health status
  let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

  if (!databaseHealthy || !storageHealthy) {
    status = 'unhealthy';
  } else {
    const workerHealth = getWorkerHealth();
    if (workerHealth.status !== 'running') {
      status = 'degraded';
    }
  }

  return {
    status,
    timestamp: now.toISOString(),
    uptime: process.uptime(),
    worker: getWorkerHealth(),
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

/**
 * Create HTTP health check server
 */
export function createHealthServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    // Set CORS headers
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

      // Set HTTP status based on health
      const statusCode = health.status === 'healthy' ? 200 :
                        health.status === 'degraded' ? 200 : 503;

      res.writeHead(statusCode);
      res.end(JSON.stringify(health, null, 2));

    } catch (error) {
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

/**
 * Start health check server
 */
export function startHealthServer(): void {
  const server = createHealthServer();

  server.listen(HEALTH_PORT, () => {
    console.log(`🏥 Health check server running on port ${HEALTH_PORT}`);
    console.log(`📊 Health endpoint: http://localhost:${HEALTH_PORT}/`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('🛑 Shutting down health server...');
    server.close(() => {
      console.log('✅ Health server closed');
    });
  });
}

/**
 * Log health status periodically
 */
export function startHealthLogging(intervalMs: number = 300000): void { // 5 minutes
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

      // Log job queue statistics
      if (health.jobs.stats.length > 0) {
        console.log('📊 Job Queue:', health.jobs.stats);
      }

    } catch (error) {
      console.error('❌ Health logging failed:', error);
    }
  }, intervalMs);
}
