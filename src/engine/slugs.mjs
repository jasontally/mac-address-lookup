/**
 * Deterministic slug generation for vendor hub URLs (/vendor/<slug>).
 * Shared by the page build (hub file names + sitemap) and the client bundle
 * (deep links from dynamic search results), so both always agree.
 *
 * Collision suffixes and the missing-ASCII fallback are resolved at build
 * time and carried in the registry data (`vendor_hub` column), keeping this
 * module purely functional.
 */
export function slugifyOrg(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
