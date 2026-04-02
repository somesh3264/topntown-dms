// next.config.js
const isDev = process.env.NODE_ENV !== "production";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Experimental features for Next.js 14 App Router
  experimental: {
    // Server Actions are stable in Next 14 — no flag needed.
    // typedRoutes: true, // uncomment when routes are finalised
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// next-pwa — only active in production builds.
// The PWA is scoped to the /(app) segment (distributor mobile experience).
// ---------------------------------------------------------------------------
let exportedConfig = nextConfig;

if (!isDev) {
  const withPWA = require("next-pwa")({
    dest: "public",
    register: true,
    skipWaiting: true,
    // Only pre-cache routes under /app/* (the Distributor PWA shell)
    scope: "/app",
    // Disable Workbox logging in production
    disable: false,
    runtimeCaching: [
      {
        // Cache all navigation requests inside the /app scope
        urlPattern: /^https:\/\/.*\/app(\/.*)?$/,
        handler: "NetworkFirst",
        options: {
          cacheName: "topntown-dms-app-pages",
          expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        // Cache Supabase REST/Storage responses
        urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "supabase-api",
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
          networkTimeoutSeconds: 10,
        },
      },
      {
        // Cache static assets aggressively
        urlPattern: /\.(?:js|css|woff2?|png|jpg|jpeg|svg|ico)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-assets",
          expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
    ],
  });

  exportedConfig = withPWA(nextConfig);
}

module.exports = exportedConfig;
