-- Database schema for the CSV Worker Service
-- This creates the necessary tables if they don't already exist

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create uploads table
CREATE TABLE IF NOT EXISTS uploads (
  id text PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  user_id text NOT NULL,
  filename text NOT NULL,
  bytes_total bigint NOT NULL DEFAULT 0,
  bytes_uploaded bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'queued', 'processing', 'completed', 'failed')),
  storage_path text,
  error text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Create jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  upload_id text NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'csv_process' CHECK (type IN ('csv_process')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'retrying')),
  attempts int NOT NULL DEFAULT 0,
  last_heartbeat_at timestamptz,
  progress int NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Create upload_chunks table
CREATE TABLE IF NOT EXISTS upload_chunks (
  id text PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  upload_id text NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  size bigint NOT NULL,
  checksum text,
  received_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(upload_id, chunk_index)
);

-- Create connections table with proper constraints
CREATE TABLE IF NOT EXISTS connections (
  id text PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "Name" text NOT NULL,
  "Profile URL" text NOT NULL,
  "Owner" text NOT NULL,
  "Email" text,
  "Company" text,
  "Title" text,
  "Connected On" text,
  url_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  -- Ensure no duplicate connections per owner based on URL hash
  UNIQUE(url_hash, "Owner")
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads(created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_upload_id ON jobs(upload_id);
CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_heartbeat ON jobs(last_heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_upload_chunks_upload_id ON upload_chunks(upload_id);
CREATE INDEX IF NOT EXISTS idx_upload_chunks_index ON upload_chunks(upload_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_connections_owner ON connections("Owner");
CREATE INDEX IF NOT EXISTS idx_connections_url_hash ON connections(url_hash);
CREATE INDEX IF NOT EXISTS idx_connections_url_hash_owner ON connections(url_hash, "Owner");
CREATE INDEX IF NOT EXISTS idx_connections_profile_url ON connections("Profile URL");
CREATE INDEX IF NOT EXISTS idx_connections_company ON connections("Company");
CREATE INDEX IF NOT EXISTS idx_connections_created_at ON connections(created_at);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at
DROP TRIGGER IF EXISTS update_uploads_updated_at ON uploads;
CREATE TRIGGER update_uploads_updated_at
  BEFORE UPDATE ON uploads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_connections_updated_at ON connections;
CREATE TRIGGER update_connections_updated_at
  BEFORE UPDATE ON connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security policies (adjust based on your auth setup)
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

-- Allow service_role to access all data
CREATE POLICY IF NOT EXISTS "Service role can access uploads" ON uploads
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY IF NOT EXISTS "Service role can access jobs" ON jobs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY IF NOT EXISTS "Service role can access upload_chunks" ON upload_chunks
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY IF NOT EXISTS "Service role can access connections" ON connections
  FOR ALL USING (auth.role() = 'service_role');

-- Allow authenticated users to access their own data
CREATE POLICY IF NOT EXISTS "Users can access own uploads" ON uploads
  FOR ALL USING (auth.uid()::text = user_id);

CREATE POLICY IF NOT EXISTS "Users can access jobs for their uploads" ON jobs
  FOR SELECT USING (upload_id IN (
    SELECT id FROM uploads WHERE user_id = auth.uid()::text
  ));

CREATE POLICY IF NOT EXISTS "Users can access chunks for their uploads" ON upload_chunks
  FOR ALL USING (upload_id IN (
    SELECT id FROM uploads WHERE user_id = auth.uid()::text
  ));

CREATE POLICY IF NOT EXISTS "Users can access their own connections" ON connections
  FOR ALL USING ("Owner" = auth.uid()::text);

-- Add helpful comments
COMMENT ON TABLE uploads IS 'Stores information about CSV file uploads';
COMMENT ON TABLE jobs IS 'Background job queue for processing uploads';
COMMENT ON TABLE upload_chunks IS 'Stores metadata about upload chunks for large files';
COMMENT ON TABLE connections IS 'Stores processed LinkedIn connection data';

COMMENT ON COLUMN connections.url_hash IS 'SHA-256 hash of normalized Profile URL for efficient duplicate detection';
COMMENT ON COLUMN jobs.last_heartbeat_at IS 'Last time the worker processing this job sent a heartbeat';
COMMENT ON COLUMN jobs.attempts IS 'Number of processing attempts for this job';
