# CSV Worker Service Monitoring Guide

This guide explains how to monitor the CSV Worker Service with comprehensive heartbeat functionality and health checks.

## Overview

The CSV Worker Service includes a robust monitoring system with:

- **HTTP Health Check Server** - Real-time health status via REST API
- **Periodic Health Logging** - Automated health status logging every 5 minutes
- **Comprehensive Health Metrics** - Database, storage, worker state, and system metrics
- **Heartbeat Monitoring** - Continuous health status updates and job progress tracking

## Health Check Endpoints

### Primary Health Endpoint

```
GET http://localhost:3001/
```

**Response Format:**
```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "worker": {
    "status": "running|stopped",
    "isShuttingDown": false,
    "currentJob": {
      "id": "job-uuid",
      "uploadId": "upload-uuid",
      "startedAt": "2024-01-15T10:25:00.000Z"
    },
    "jobsProcessed": 42,
    "uptime": 3600,
    "memoryUsage": {
      "rss": 50331648,
      "heapTotal": 20971520,
      "heapUsed": 15728640,
      "external": 1048576,
      "arrayBuffers": 524288
    },
    "config": {
      "pollInterval": 5000,
      "batchSize": 1000,
      "maxRetries": 3
    }
  },
  "database": {
    "connected": true,
    "lastCheck": "2024-01-15T10:30:00.000Z"
  },
  "storage": {
    "connected": true,
    "lastCheck": "2024-01-15T10:30:00.000Z"
  },
  "jobs": {
    "stats": [
      { "status": "queued", "count": 5 },
      { "status": "running", "count": 1 },
      { "status": "completed", "count": 100 },
      { "status": "failed", "count": 2 }
    ],
    "lastCheck": "2024-01-15T10:29:00.000Z"
  },
  "memory": {
    "rss": 50331648,
    "heapTotal": 20971520,
    "heapUsed": 15728640,
    "external": 1048576,
    "arrayBuffers": 524288
  },
  "environment": {
    "nodeVersion": "v18.17.0",
    "platform": "linux",
    "arch": "x64"
  }
}
```

### Health Status Levels

- **healthy** - All systems operational
- **degraded** - Worker not running but infrastructure is healthy
- **unhealthy** - Database or storage connection issues

### HTTP Status Codes

- `200` - Healthy or degraded status
- `503` - Unhealthy status or health check failure

## Monitoring Integration

### Docker Health Checks

Add to your `docker-compose.yml`:

```yaml
services:
  csv-worker:
    build: .
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Kubernetes Health Checks

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: csv-worker
spec:
  template:
    spec:
      containers:
      - name: csv-worker
        image: csv-worker:latest
        ports:
        - containerPort: 3001
          name: health
        livenessProbe:
          httpGet:
            path: /
            port: health
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /
            port: health
          initialDelaySeconds: 5
          periodSeconds: 10
```

### Prometheus Monitoring

Example Prometheus configuration:

```yaml
scrape_configs:
  - job_name: 'csv-worker'
    static_configs:
      - targets: ['csv-worker:3001']
    metrics_path: /
    scrape_interval: 30s
```

### Grafana Dashboard

Key metrics to monitor:

1. **Worker Status** - `worker.status`
2. **Jobs Processed** - `worker.jobsProcessed`
3. **Memory Usage** - `memory.heapUsed`
4. **Database Health** - `database.connected`
5. **Storage Health** - `storage.connected`
6. **Job Queue Stats** - `jobs.stats`

## Automated Health Logging

The worker automatically logs health status every 5 minutes:

```
🏥 Health Status: {
  status: 'healthy',
  uptime: 3600,
  worker: 'running',
  database: true,
  storage: true,
  jobsProcessed: 42,
  memoryUsage: '15MB'
}
📊 Job Queue: [
  { status: 'queued', count: 5 },
  { status: 'running', count: 1 },
  { status: 'completed', count: 100 }
]
```

## Environment Configuration

Configure monitoring behavior with environment variables:

```bash
# Health server port (default: 3001)
HEALTH_PORT=3001

# Worker heartbeat interval (default: 30000ms)
WORKER_HEARTBEAT_INTERVAL=30000

# Health logging interval (default: 300000ms = 5 minutes)
HEALTH_LOG_INTERVAL=300000
```

## Alerting Examples

### Basic Health Check Script

```bash
#!/bin/bash
HEALTH_URL="http://localhost:3001/"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $RESPONSE -ne 200 ]; then
    echo "ALERT: CSV Worker unhealthy (HTTP $RESPONSE)"
    # Send alert notification
fi
```

### Advanced Monitoring Script

```bash
#!/bin/bash
HEALTH_DATA=$(curl -s http://localhost:3001/)
STATUS=$(echo $HEALTH_DATA | jq -r '.status')
WORKER_STATUS=$(echo $HEALTH_DATA | jq -r '.worker.status')
DB_CONNECTED=$(echo $HEALTH_DATA | jq -r '.database.connected')

if [ "$STATUS" = "unhealthy" ]; then
    echo "CRITICAL: CSV Worker is unhealthy"
elif [ "$WORKER_STATUS" = "stopped" ]; then
    echo "WARNING: CSV Worker is stopped"
elif [ "$DB_CONNECTED" = "false" ]; then
    echo "CRITICAL: Database connection lost"
fi
```

## Troubleshooting

### Common Issues

1. **Health server not responding**
   - Check if port 3001 is available
   - Verify HEALTH_PORT environment variable
   - Check worker startup logs

2. **Database health check failing**
   - Verify Supabase connection credentials
   - Check network connectivity
   - Review database logs

3. **Storage health check failing**
   - Verify Supabase Storage configuration
   - Check storage bucket permissions
   - Review storage service status

### Debug Commands

```bash
# Check health endpoint
curl -v http://localhost:3001/

# Check worker logs
docker logs csv-worker

# Check worker process
ps aux | grep worker

# Check port availability
netstat -tlnp | grep 3001
```

## Production Deployment

### Recommended Monitoring Stack

1. **Health Checks**: Built-in HTTP endpoint
2. **Metrics Collection**: Prometheus
3. **Visualization**: Grafana
4. **Alerting**: Prometheus AlertManager
5. **Log Aggregation**: ELK Stack or similar

### Sample Alert Rules

```yaml
groups:
- name: csv-worker
  rules:
  - alert: CSVWorkerDown
    expr: up{job="csv-worker"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "CSV Worker is down"

  - alert: CSVWorkerUnhealthy
    expr: csv_worker_status != 1
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "CSV Worker is unhealthy"
```

This comprehensive monitoring system ensures you can track the health, performance, and status of your CSV Worker Service in real-time with proper alerting and observability.
