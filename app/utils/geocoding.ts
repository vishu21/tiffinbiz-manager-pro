
export interface GeoCoordinates {
  lat: number;
  lng: number;
}

/**
 * Geocodes an address string using free OpenStreetMap Nominatim API.
 * Appends 'London, ON, Canada' if city/province are omitted.
 */
export async function geocodeAddress(rawAddress: string): Promise<GeoCoordinates | null> {
  const address = (rawAddress || '').trim();
  if (!address || address === '—' || address.toLowerCase() === 'pickup') {
    return null;
  }

  // Ensure query has city context
  const hasCityContext = /london/i.test(address);
  const query = hasCityContext ? address : `${address}, London, ON, Canada`;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=ca`;
    
    const res = await fetch(url, {
      headers: {
        // Nominatim policy requires a custom User-Agent identifier
        'User-Agent': 'TiffinKitchenApp/1.0 (dispatch-routing)',
      },
      next: { revalidate: 86400 * 30 }, // Cache resolution for 30 days
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
  } catch (err) {
    console.error(`[Geocoding Error] Failed to resolve address: "${address}"`, err);
  }

  return null;
}
