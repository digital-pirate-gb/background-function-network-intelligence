-- RPC Functions for the CSV Worker Service
-- These functions provide atomic operations for job and upload management

-- Function to get the next available job and mark it as running
CREATE OR REPLACE FUNCTION get_next_job(p_job_type text DEFAULT 'csv_process')
RETURNS TABLE (
  id text,
  upload_id text,
  type text,
  status text,
  attempts int,
  last_heartbeat_at timestamptz,
  progress int,
  error text,
  result jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_record RECORD;
BEGIN
  -- Try to get and update a job atomically
  UPDATE jobs
  SET
    status = 'running',
    updated_at = NOW(),
    last_heartbeat_at = NOW()
  WHERE id = (
    SELECT j.id
    FROM jobs j
    WHERE j.type = p_job_type
      AND j.status = 'queued'
    ORDER BY j.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO job_record;

  -- If we found a job, return it
  IF FOUND THEN
    RETURN QUERY
    SELECT
      job_record.id,
      job_record.upload_id,
      job_record.type,
      job_record.status,
      job_record.attempts,
      job_record.last_heartbeat_at,
      job_record.progress,
      job_record.error,
      job_record.result,
      job_record.created_at,
      job_record.updated_at;
  ELSE
    -- Return null values to indicate no job available
    RETURN QUERY
    SELECT
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::int,
      NULL::timestamptz,
      NULL::int,
      NULL::text,
      NULL::jsonb,
      NULL::timestamptz,
      NULL::timestamptz;
  END IF;
END;
$$;

-- Function to update job progress with heartbeat
CREATE OR REPLACE FUNCTION update_job_progress(
  p_job_id text,
  p_status text DEFAULT NULL,
  p_progress int DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_heartbeat boolean DEFAULT true,
  p_result jsonb DEFAULT NULL
)
RETURNS TABLE (
  id text,
  upload_id text,
  type text,
  status text,
  attempts int,
  last_heartbeat_at timestamptz,
  progress int,
  error text,
  result jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_record RECORD;
BEGIN
  UPDATE jobs
  SET
    status = COALESCE(p_status, status),
    progress = COALESCE(p_progress, progress),
    error = CASE
      WHEN p_error IS NOT NULL THEN p_error
      WHEN p_status = 'succeeded' THEN NULL
      ELSE error
    END,
    result = CASE
      WHEN p_result IS NOT NULL THEN p_result
      ELSE result
    END,
    updated_at = NOW(),
    last_heartbeat_at = CASE
      WHEN p_heartbeat THEN NOW()
      ELSE last_heartbeat_at
    END,
    attempts = CASE
      WHEN p_status = 'retrying' THEN attempts + 1
      ELSE attempts
    END
  WHERE id = p_job_id
  RETURNING * INTO job_record;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job with id % not found', p_job_id;
  END IF;

  RETURN QUERY
  SELECT
    job_record.id,
    job_record.upload_id,
    job_record.type,
    job_record.status,
    job_record.attempts,
    job_record.last_heartbeat_at,
    job_record.progress,
    job_record.error,
    job_record.result,
    job_record.created_at,
    job_record.updated_at;
END;
$$;

-- Function to update upload status
CREATE OR REPLACE FUNCTION update_upload_status(
  p_upload_id text,
  p_status text DEFAULT NULL,
  p_bytes_uploaded bigint DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  user_id text,
  filename text,
  bytes_total bigint,
  bytes_uploaded bigint,
  status text,
  storage_path text,
  created_at timestamptz,
  updated_at timestamptz,
  error text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  upload_record RECORD;
BEGIN
  UPDATE uploads
  SET
    status = COALESCE(p_status, status),
    bytes_uploaded = COALESCE(p_bytes_uploaded, bytes_uploaded),
    error = CASE
      WHEN p_error IS NOT NULL THEN p_error
      WHEN p_status = 'completed' THEN NULL
      ELSE error
    END,
    updated_at = NOW()
  WHERE id = p_upload_id
  RETURNING * INTO upload_record;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload with id % not found', p_upload_id;
  END IF;

  RETURN QUERY
  SELECT
    upload_record.id,
    upload_record.user_id,
    upload_record.filename,
    upload_record.bytes_total,
    upload_record.bytes_uploaded,
    upload_record.status,
    upload_record.storage_path,
    upload_record.created_at,
    upload_record.updated_at,
    upload_record.error;
END;
$$;

-- Function to process connections batch with atomic upserts
CREATE OR REPLACE FUNCTION process_connections_batch(records jsonb)
RETURNS TABLE (
  inserted_count int,
  duplicate_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  record_count int;
  inserted_count_val int := 0;
  duplicate_count_val int := 0;
  connection_record jsonb;
BEGIN
  -- Get total count of records
  SELECT jsonb_array_length(records) INTO record_count;

  -- Process each record in the batch
  FOR connection_record IN SELECT jsonb_array_elements(records)
  LOOP
    -- Try to insert, on conflict do nothing (duplicate detection via url_hash)
    INSERT INTO connections (
      "Name",
      "Profile URL",
      "Owner",
      "Email",
      "Company",
      "Title",
      "Connected On",
      "url_hash",
      created_at,
      updated_at
    )
    VALUES (
      connection_record->>'Name',
      connection_record->>'Profile URL',
      connection_record->>'Owner',
      NULLIF(connection_record->>'Email', ''),
      NULLIF(connection_record->>'Company', ''),
      NULLIF(connection_record->>'Title', ''),
      NULLIF(connection_record->>'Connected On', ''),
      connection_record->>'url_hash',
      NOW(),
      NOW()
    )
    ON CONFLICT (url_hash, "Owner") DO NOTHING;

    -- Check if the insert was successful
    IF FOUND THEN
      inserted_count_val := inserted_count_val + 1;
    ELSE
      duplicate_count_val := duplicate_count_val + 1;
    END IF;
  END LOOP;

  -- Return the counts
  RETURN QUERY
  SELECT
    inserted_count_val,
    duplicate_count_val;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_next_job(text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_job_progress(text, text, int, text, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION update_upload_status(text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION process_connections_batch(jsonb) TO authenticated;

-- Grant execute permissions to service_role (for the worker)
GRANT EXECUTE ON FUNCTION get_next_job(text) TO service_role;
GRANT EXECUTE ON FUNCTION update_job_progress(text, text, int, text, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION update_upload_status(text, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION process_connections_batch(jsonb) TO service_role;
