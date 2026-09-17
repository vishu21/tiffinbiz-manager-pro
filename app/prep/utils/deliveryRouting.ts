export interface DeliveryCustomer {
  id: string;
  full_name?: string;
  name?: string;
  delivery_address?: string | null;
  address?: string | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  is_pickup?: boolean | null;
  pickup_days?: string[] | null;
  portion_size?: string | null;
  portion?: string | null;
  meal_type?: string | null;
  roti_count?: number | null;
  pronthi_count?: number | null;
  rice_count?: string | null;
  status?: string;
  isSkipped?: boolean;
  notes?: string | null;
  dietary_notes?: string | null;
  [key: string]: any;
}

export interface SplitManifestResult {
  pickups: DeliveryCustomer[];
  deliveries: DeliveryCustomer[];
}

export interface DeliveryRun {
  runIndex: number;
  label: string;
  stops: DeliveryCustomer[];
  mapsUrl: string;
}

export interface AddressGroup {
  address: string;
  coords: { lat: number; lng: number };
  customers: DeliveryCustomer[];
}

// Kitchen Hub: 3270 Singleton Ave, London, ON N6L 0E5
export const DEFAULT_KITCHEN_ORIGIN = "Unit 42, 3270 Singleton Ave, London, ON N6L 0E5";
const KITCHEN_COORDS = { lat: 42.9383, lng: -81.2666 };

// EXACT coordinates for every street appearing in your packing manifest
const STREET_COORDINATE_OVERRIDES: Array<{ pattern: RegExp; lat: number; lng: number }> = [
  // Kitchen Base (Southwest)
  { pattern: /singleton/i, lat: 42.9383, lng: -81.2666 },

  // West & Northwest Corridor
  { pattern: /beachwood/i, lat: 42.9642, lng: -81.2721 },       // Westmount
  { pattern: /wonderland/i, lat: 42.9550, lng: -81.2850 },      // West London
  { pattern: /denlaw/i, lat: 43.0180, lng: -81.2980 },          // Northwest (Hyde Park)
  { pattern: /queensborough/i, lat: 43.0232, lng: -81.3005 },   // Northwest (Aldersbrook / 600m from Denlaw!)
  { pattern: /roulston/i, lat: 43.0110, lng: -81.2880 },        // Northwest
  // West & Central North (matches "Wharncliffe", "Wharncliffe Rd", "Wharncliffe Road North", etc.)
  { pattern: /wharncliffe.*(?:n|north)/i, lat: 42.9970, lng: -81.2640 },
  { pattern: /beaufort/i, lat: 42.9940, lng: -81.2680 },
  // Downtown Core (strictly grouped together)
  { pattern: /king\s*st/i, lat: 42.9825, lng: -81.2515 },
  { pattern: /fullarton/i, lat: 42.9835, lng: -81.2520 },

  // Northeast / Masonville / Airport
  { pattern: /stackhouse/i, lat: 43.0378, lng: -81.2012 },      // Northeast (Highbury & Fanshawe)
  { pattern: /clarke/i, lat: 42.9985, lng: -81.1870 },          // East (Argyle)
  { pattern: /portsmouth/i, lat: 43.0035, lng: -81.1680 },      // East
  { pattern: /dixie/i, lat: 43.0090, lng: -81.1820 },           // East

  // Southeast & South Corridor
  // Charlie Hajjar is far East off Bradley & Veterans Memorial Pkwy:
  { pattern: /charlie\s*hajjar/i, lat: 42.9420, lng: -81.1448 },
  // Evans Blvd is West of Charlie Hajjar, near Highbury / Summerside:
  { pattern: /evans/i, lat: 42.9460, lng: -81.1710 },
  // Cantley Cres is further West in White Oaks on the way back to base:
  { pattern: /cantley/i, lat: 42.9325, lng: -81.2210 },
];

export function sanitizeAddressForUrl(addr: string): string {
  if (!addr) return "";
  return addr.replace(/#/g, "Unit ").trim();
}

export function normalizeAddressKey(addr: string): string {
  return (addr || "")
    .toLowerCase()
    .replace(/[,\.#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getCustomerDeliveryAddress(customer: DeliveryCustomer): string {
  if (!customer) return "";
  const raw = customer.delivery_address || customer.address || "";
  return typeof raw === "string" ? raw.trim() : "";
}

export function extractFSA(address: string): string {
  const match = address.toUpperCase().match(/\b(N[0-9][A-Z])\b/);
  return match ? match[1] : "UNKNOWN";
}

export function getCustomerCoordinates(customer: DeliveryCustomer, address: string): { lat: number; lng: number } {
  // Use stored coordinates if available (from geocoding backfill)
  if (
    customer.delivery_lat != null &&
    customer.delivery_lng != null &&
    typeof customer.delivery_lat === 'number' &&
    typeof customer.delivery_lng === 'number' &&
    isFinite(customer.delivery_lat) &&
    isFinite(customer.delivery_lng)
  ) {
    return { lat: customer.delivery_lat, lng: customer.delivery_lng };
  }

  const clean = (address || "").toLowerCase();

  for (const override of STREET_COORDINATE_OVERRIDES) {
    if (override.pattern.test(clean)) {
      return { lat: override.lat, lng: override.lng };
    }
  }

  return { lat: 42.9849, lng: -81.2453 };
}

function calculateDistance(
  coord1: { lat: number; lng: number },
  coord2: { lat: number; lng: number }
): number {
  const dLat = coord1.lat - coord2.lat;
  const dLng = (coord1.lng - coord2.lng) * Math.cos((coord1.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function isCustomerPickupOrder(customer: DeliveryCustomer, activeDay?: string): boolean {
  if (!customer) return false;
  if (customer.is_pickup === true || customer.isPickup === true) return true;
  if (activeDay && Array.isArray(customer.pickup_days) && customer.pickup_days.includes(activeDay)) {
    return true;
  }
  const addr = getCustomerDeliveryAddress(customer).toLowerCase();
  return addr === "pickup" || addr === "pu" || addr === "counter pickup" || addr === "self pickup";
}

export function splitPickupsAndDeliveries(
  customers: DeliveryCustomer[],
  activeDay?: string
): SplitManifestResult {
  const pickups: DeliveryCustomer[] = [];
  const deliveries: DeliveryCustomer[] = [];

  for (const customer of customers) {
    if (customer.isSkipped || customer.status?.toLowerCase() === "skipped") continue;

    if (isCustomerPickupOrder(customer, activeDay)) {
      pickups.push(customer);
      continue;
    }

    const addr = getCustomerDeliveryAddress(customer);
    if (addr && addr !== "—" && addr.length > 3) {
      deliveries.push(customer);
    } else {
      pickups.push(customer);
    }
  }

  return { pickups, deliveries };
}

export function getUniqueAddressGroups(deliveries: DeliveryCustomer[]): AddressGroup[] {
  const groupMap = new Map<string, AddressGroup>();
  for (const customer of deliveries) {
    const addr = getCustomerDeliveryAddress(customer);
    const key = normalizeAddressKey(addr);

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        address: addr,
        coords: getCustomerCoordinates(customer, addr),
        customers: [customer],
      });
    } else {
      groupMap.get(key)!.customers.push(customer);
    }
  }
  return Array.from(groupMap.values());
}

/**
 * True Chained Nearest-Neighbor:
 * Takes the chosen First Stop, then finds the physically closest remaining address to it,
 * step-by-step until all addresses are chained in real geographic order.
 */
/**
 * 2-Opt local search: reverses sub-tours that cause crossing edges or backtracking loops.
 */
function apply2Opt(tour: AddressGroup[]): AddressGroup[] {
  if (tour.length <= 2) return tour;

  let stops = [...tour];
  let improved = true;
  let iterations = 0;

  const getTourDistance = (route: AddressGroup[]): number => {
    let total = 0;
    for (let i = 0; i < route.length - 1; i++) {
      total += calculateDistance(route[i].coords, route[i + 1].coords);
    }
    // Factor in heading back toward Kitchen Hub after the last stop
    total += calculateDistance(route[route.length - 1].coords, KITCHEN_COORDS);
    return total;
  };

  while (improved && iterations < 50) {
    improved = false;
    iterations++;

    // Preserve Stop #1 (i starts at 1 so the selected First Stop never changes)
    for (let i = 1; i < stops.length - 1; i++) {
      for (let k = i + 1; k < stops.length; k++) {
        const candidate = [
          ...stops.slice(0, i),
          ...stops.slice(i, k + 1).reverse(),
          ...stops.slice(k + 1),
        ];

        if (getTourDistance(candidate) < getTourDistance(stops) - 0.0001) {
          stops = candidate;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return stops;
}

/**
 * Chained Nearest-Neighbor with 2-Opt Loop Elimination:
 * 1. Locks in selected First Stop.
 * 2. Chains nearest neighbors.
 * 3. Applies 2-Opt to uncross loops and backtracks.
 */
export function sortDeliveriesChained(
  deliveries: DeliveryCustomer[],
  firstStopAddressKey?: string
): AddressGroup[] {
  if (deliveries.length === 0) return [];

  const remaining = getUniqueAddressGroups(deliveries);
  const orderedTour: AddressGroup[] = [];

  let firstIdx = -1;
  if (firstStopAddressKey) {
    firstIdx = remaining.findIndex(
      (g) => normalizeAddressKey(g.address) === normalizeAddressKey(firstStopAddressKey)
    );
  }

  if (firstIdx === -1) {
    let minKitchenDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = calculateDistance(KITCHEN_COORDS, remaining[i].coords);
      if (dist < minKitchenDist) {
        minKitchenDist = dist;
        firstIdx = i;
      }
    }
  }

  const [firstStop] = remaining.splice(firstIdx, 1);
  orderedTour.push(firstStop);
  let currentCoords = firstStop.coords;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let shortestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = calculateDistance(currentCoords, remaining[i].coords);
      if (dist < shortestDist) {
        shortestDist = dist;
        nearestIdx = i;
      }
    }

    const [nextStop] = remaining.splice(nearestIdx, 1);
    orderedTour.push(nextStop);
    currentCoords = nextStop.coords;
  }

  // Uncross any loops while preserving Stop #1
  return apply2Opt(orderedTour);
}

export function generateGoogleMapsRuns(
  deliveries: DeliveryCustomer[],
  kitchenOrigin: string = DEFAULT_KITCHEN_ORIGIN,
  maxStopsPerRun: number = 9,
  firstStopAddressKey?: string
): DeliveryRun[] {
  if (deliveries.length === 0) return [];

  // 1. Get the fully chained, unbroken sequence of unique physical address stops
  const uniqueStops = sortDeliveriesChained(deliveries, firstStopAddressKey);

  const activeOrigin =
    !kitchenOrigin || kitchenOrigin.trim() === "London, ON"
      ? DEFAULT_KITCHEN_ORIGIN
      : kitchenOrigin;

  const runs: DeliveryRun[] = [];
  const totalRuns = Math.ceil(uniqueStops.length / maxStopsPerRun);

  for (let i = 0; i < totalRuns; i++) {
    const startIdx = i * maxStopsPerRun;
    const stopBatch = uniqueStops.slice(startIdx, startIdx + maxStopsPerRun);

    if (stopBatch.length === 0) continue;

    const rawStart =
      i === 0 ? activeOrigin : uniqueStops[startIdx - 1]?.address || activeOrigin;

    const origin = encodeURIComponent(sanitizeAddressForUrl(rawStart));
    const lastStop = stopBatch[stopBatch.length - 1];
    const destination = encodeURIComponent(sanitizeAddressForUrl(lastStop.address));

    const intermediateStops = stopBatch.slice(0, -1);
    const waypointsParam =
      intermediateStops.length > 0
        ? `&waypoints=${intermediateStops
          .map((s) => encodeURIComponent(sanitizeAddressForUrl(s.address)))
          .join("|")}`
        : "";

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointsParam}&travelmode=driving`;
    const allCustomersInRun = stopBatch.flatMap((s) => s.customers);

    runs.push({
      runIndex: i + 1,
      label:
        totalRuns === 1
          ? "Full Delivery Route"
          : `Run ${i + 1} (${stopBatch.length} Stops · ${allCustomersInRun.length} Meals)`,
      stops: allCustomersInRun,
      mapsUrl,
    });
  }

  return runs;
}