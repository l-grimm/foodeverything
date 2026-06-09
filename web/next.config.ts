import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Activate the cacheComponents pipeline — its real value to us is the
  // React <Activity> navigation cache, which keeps the last ~3 routes
  // mounted (DOM + state intact) when the user navigates away. That makes
  // "tap recipe → tap All recipes" restore scroll position AND the
  // Seasonal/Coverage tab choice natively, with no manual sessionStorage
  // bookkeeping. Safe for us because we have no `force-static`, no
  // `revalidate`, no `fetchCache` — everything is already dynamic at
  // request time, which is exactly cacheComponents' default behavior.
  cacheComponents: true,
};

export default nextConfig;
