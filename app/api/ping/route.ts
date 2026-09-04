import { createClient } from '@supabase/supabase-js';

// Supabase free-tier projects are paused after 7 days with no API activity.
// cron-job.org / UptimeRobot hits this URL every 24h so the project always
// shows daily automated activity and never gets paused.
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || (!anonKey && !serviceRoleKey)) {
    return Response.json(
      {
        ok: false,
        error:
          'Missing Supabase configuration. Set NEXT_PUBLIC_SUPABASE_URL and (optionally) SUPABASE_SERVICE_ROLE_KEY.',
      },
      { status: 500 }
    );
  }

  // Use the service-role key when present (bypasses RLS and guarantees a real
  // read against the database). Fall back to the anon key otherwise.
  const key = serviceRoleKey ?? anonKey!;
  const supabase = createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    const { data, error } = await supabase
      .from('customers')
      .select('id')
      .limit(1);

    if (error) {
      console.error('[ping] Supabase keep-alive query failed:', error.message);
      return Response.json(
        { ok: false, error: error.message, ts: new Date().toISOString() },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,
      ts: new Date().toISOString(),
      customersReachable: true,
      sampleCustomerId: data?.[0]?.id ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error during keep-alive ping';
    console.error('[ping] Supabase keep-alive ping threw:', message);
    return Response.json(
      { ok: false, error: message, ts: new Date().toISOString() },
      { status: 502 }
    );
  }
}
