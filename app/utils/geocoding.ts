// London, Ontario default kitchen center
export const DEFAULT_KITCHEN_COORDS = {
  lat: 42.9849,
  lng: -81.2453,
};

export type Coordinates = {
  lat: number;
  lng: number;
};

/**
 * Strips unit/apartment prefixes (e.g., "#304 100 Fullarton St" -> "100 Fullarton St")
 * so the geocoder matches the physical street address reliably.
 */
export function sanitizeAddressForGeocoding(address: string): string {
  let cleaned = address.trim();
  cleaned = cleaned.replace(/^\s*(?:apt|apartment|unit|suite|ste|ph|#)\s*[\w\d-]+\s*[,-]?\s*/i, '');
  cleaned = cleaned.replace(/^[\w\d]+-\s*(\d+)/i, '$1');

  if (!cleaned.toLowerCase().includes('london')) {
    cleaned += ', London, ON';
  }
  return cleaned;
}

/**
 * Free geocoding via OpenStreetMap Nominatim.
 * Nominatim requires a custom User-Agent header.
 */
export async function geocodeAddress(address: string): Promise<Coordinates | null> {
  const query = sanitizeAddressForGeocoding(address);
  if (!query || query.length < 5) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query
    )}&limit=1`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TiffinManagerOS-DeliveryOptimizer/1.0',
        Accept: 'application/json',
      },
      next: { revalidate: 86400 }, // Cache coordinates for 24h
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
    return null;
  } catch (err) {
    console.warn(`[Geocoding] Failed to geocode "${address}":`, err);
    return null;
  }
}

/**
 * Haversine straight-line distance in kilometers between two coordinate pairs.
 */
export function haversineDistance(c1: Coordinates, c2: Coordinates): number {
  const R = 6371; // Earth radius in km
  const dLat = ((c2.lat - c1.lat) * Math.PI) / 180;
  const dLon = ((c2.lng - c1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((c1.lat * Math.PI) / 180) *
      Math.cos((c2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Smart Nearest-Neighbor Algorithm with 2-Opt path untangling.
 * Chains from kitchen base to the nearest stop, then to the nearest neighbor.
 */
export function optimizeRouteNearestNeighbor<
  T extends {
    id: string;
    lat?: number | null;
    lng?: number | null;
    delivery_lat?: number | null;
    delivery_lng?: number | null;
  }
>(
  items: T[],
  startCoords: Coordinates = DEFAULT_KITCHEN_COORDS
): T[] {
  if (items.length <= 2) return items;

  const validStops: (T & { coords: Coordinates })[] = [];
  const missingStops: T[] = [];

  for (const item of items) {
    const lat = typeof item.delivery_lat === 'number' ? item.delivery_lat : item.lat;
    const lng = typeof item.delivery_lng === 'number' ? item.delivery_lng : item.lng;

    if (typeof lat === 'number' && typeof lng === 'number') {
      validStops.push({ ...item, coords: { lat, lng } });
    } else {
      missingStops.push(item);
    }
  }

  if (validStops.length <= 1) return items;

  // 1. Greedy Nearest-Neighbor Chain
  const unvisited = [...validStops];
  const route: (T & { coords: Coordinates })[] = [];
  let currentCoords = startCoords;

  while (unvisited.length > 0) {
    let nearestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = haversineDistance(currentCoords, unvisited[i].coords);
      if (dist < minDistance) {
        minDistance = dist;
        nearestIndex = i;
      }
    }

    const [nextStop] = unvisited.splice(nearestIndex, 1);
    route.push(nextStop);
    currentCoords = nextStop.coords;
  }

  // 2. 2-Opt Untangling Loop (smooths out criss-crossing paths)
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 50) {
    improved = false;
    iterations++;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const prevA = i === 0 ? startCoords : route[i - 1].coords;
        const curA = route[i].coords;
        const curB = route[k].coords;
        const nextB = k === route.length - 1 ? startCoords : route[k + 1].coords;

        const currentDist = haversineDistance(prevA, curA) + haversineDistance(curB, nextB);
        const newDist = haversineDistance(prevA, curB) + haversineDistance(curA, nextB);

        if (newDist < currentDist - 0.001) {
          // Reverse the segment between i and k
          const segment = route.slice(i, k + 1).reverse();
          route.splice(i, segment.length, ...segment);
          improved = true;
        }
      }
    }
  }

  // Return optimized stops with any un-geocoded stops placed at the end
  return [...route, ...missingStops];
}