const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

if (!process.env.SUPABASE_URL) {
  throw new Error('Missing environment variable: SUPABASE_URL');
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('Missing environment variable: SUPABASE_SERVICE_KEY');
}

// Create Supabase client with service role key for full access
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      persistSession: false,
    },
    db: {
      schema: 'public'
    }
  }
);

// Test connection on startup
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from('uploads')
      .select('count')
      .limit(1);

    if (error) {
      console.error('❌ Supabase connection test failed:', error.message);
      process.exit(1);
    }

    console.log('✅ Supabase connection established');
  } catch (error) {
    console.error('❌ Failed to connect to Supabase:', error.message);
    process.exit(1);
  }
}

module.exports = {
  supabase,
  testConnection
};
