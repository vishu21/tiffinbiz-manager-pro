import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca';

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials. Ensure .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch customers missing delivery coordinates
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, delivery_address')
    .is('delivery_lat', null)
    .not('delivery_address', 'is', null)
    .neq('delivery_address', '')
    .neq('delivery_address', '—')
    .neq('delivery_address', 'pickup');

  if (error) {
    console.error('Failed to fetch customers:', error.message);
    process.exit(1);
  }

  if (!customers || customers.length === 0) {
    console.log('No customers found needing coordinate backfill.');
    return;
  }

  console.log(`Found ${customers.length} customer(s) to geocode.`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const rawAddress = (customer.delivery_address || '').trim();
    if (!rawAddress) {
      failCount++;
      continue;
    }

    // Append London context if not already present
    const hasCityContext = /london/i.test(rawAddress);
    const query = hasCityContext ? rawAddress : `${rawAddress}, London, ON, Canada`;

    const url = `${NOMINATIM_BASE}&q=${encodeURIComponent(query)}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'TiffinKitchenApp-Backfill/1.0',
        },
      });

      if (!res.ok) {
        console.error(`[${i + 1}/${customers.length}] HTTP ${res.status} for "${rawAddress}" — skipping`);
        failCount++;
        continue;
      }

      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);

        const { error: updateError } = await supabase
          .from('customers')
          .update({ delivery_lat: lat, delivery_lng: lng })
          .eq('id', customer.id);

        if (updateError) {
          console.error(`[${i + 1}/${customers.length}] DB update failed for "${rawAddress}": ${updateError.message}`);
          failCount++;
        } else {
          console.log(`[${i + 1}/${customers.length}] ✓ ${rawAddress} → (${lat}, ${lng})`);
          successCount++;
        }
      } else {
        console.warn(`[${i + 1}/${customers.length}] No results for "${rawAddress}" — skipping`);
        failCount++;
      }
    } catch (err: any) {
      console.error(`[${i + 1}/${customers.length}] Fetch error for "${rawAddress}": ${err.message}`);
      failCount++;
    }

    // Nominatim requires a minimum 1-second delay between requests
    if (i < customers.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }

  console.log(`\nBackfill complete: ${successCount} succeeded, ${failCount} failed.`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});