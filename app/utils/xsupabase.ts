import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Use the Service Role Key on the server for admin-level access 
// that bypasses Row Level Security (RLS).
export const supabase = createClient(supabaseUrl, supabaseServiceKey);