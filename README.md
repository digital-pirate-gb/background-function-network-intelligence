# CSV Worker Service

A TypeScript-based background worker service for processing CSV uploads in the bulletproof upload architecture.

## Features

- ✅ **Bulletproof Processing** - No timeout limits, handles multi-GB files
- ✅ **TypeScript** - Full type safety and excellent developer experience
- ✅ **Supabase Integration** - Works with existing database schema and storage
- ✅ **Real-time Progress** - Updates job progress and heartbeat monitoring
- ✅ **Retry Logic** - Automatic retry with exponential backoff
- ✅ **Graceful Shutdown** - Handles interruptions safely
- ✅ **Docker Ready** - Easy deployment with Docker

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

Copy the environment template:

```bash
cp .env.example .env
```

Configure your environment variables:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Worker Configuration
WORKER_POLL_INTERVAL=5000
WORKER_BATCH_SIZE=1000
WORKER_MAX_RETRIES=3
WORKER_HEARTBEAT_INTERVAL=30000

# Storage Configuration
STORAGE_BUCKET=csv-uploads
```

### 3. Development

```bash
# Start in development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Start production build
npm start

# Type checking
npm run typecheck
```

## Deployment

### Docker Deployment

```bash
# Build Docker image
npm run docker:build

# Run with Docker
npm run docker:run
```

### Railway/Render Deployment

1. Connect your repository to Railway or Render
2. Set environment variables in dashboard
3. Deploy automatically on push

## Integration with Next.js App

The worker integrates with your existing Next.js app through the shared database schema:

- `uploads` table - file metadata
- `jobs` table - processing queue
- `upload_chunks` table - chunk audit trail

## Architecture

```
Next.js App → Job Queue → CSV Worker → Database
     ↓           ↓           ↓           ↓
Storage API → Supabase → Storage → LinkedIn Connections
```

## License

MIT License
