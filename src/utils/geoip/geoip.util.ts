/**
 * Safe GeoIP lookup. Uses lazy require so GEODATADIR (set by bundle banner) is
 * applied before geoip-lite loads. Returns undefined on any error so the app
 * never crashes for missing module or data files.
 */
type GeoLookupResult = {
  country?: string;
  region?: string;
  city?: string;
  ll?: [number, number];
  [key: string]: unknown;
} | null;

let geoipModule: { lookup: (ip: string) => GeoLookupResult } | null = null;

function getGeoip(): typeof geoipModule {
  if (geoipModule != null) return geoipModule;
  try {
    geoipModule = require("geoip-lite");
    return geoipModule;
  } catch {
    return null;
  }
}

/**
 * Look up geo data for an IP. Returns undefined if IP is missing, module fails,
 * or lookup throws (e.g. ENOENT on data files).
 */
export function lookupIp(ip: string | undefined): GeoLookupResult | undefined {
  if (!ip) return undefined;
  try {
    const geoip = getGeoip();
    return geoip?.lookup(ip) ?? undefined;
  } catch {
    return undefined;
  }
}
