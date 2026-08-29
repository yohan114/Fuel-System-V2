import type { NextConfig } from "next";

// ONE port for the whole system.
//
// This app used to run on 6600 and was moved to 3300, but the origin allow-lists
// below kept naming 6600 long after nothing listened there. That is not cosmetic:
// Next.js rejects a server action whose Origin header is not on the list, so a
// stale port here means forms silently fail for anyone who reaches the app on
// that address — while ordinary page loads keep working, which makes it look
// like a bug in the form rather than a config mismatch.
//
// The port now comes from one place. Change PORT (or the -p flag in
// package.json's dev/start scripts, which sets the same number) and the allowed
// origins follow automatically.
const PORT = process.env.PORT ?? "3300";

// The hostnames this system is reached by: in production behind Cloudflare and
// the reverse proxy, and locally on the LAN. Kept in one array so the dev-origin
// list and the server-action list cannot drift apart — previously they were
// duplicated by hand and had to be edited twice.
//
// ENTRIES ARE HOSTS, NEVER URLS. Next compares against `new URL(origin).host`
// (server/app-render/csrf-protection.js), which is "example.com" or
// "example.com:3300" and never carries a scheme. Every "https://..." entry this
// list used to hold was therefore dead weight that matched nothing — harmless
// in itself, but it hid a real fault: the only LAN entry was written
// "http://192.168.8.200:3300", so it never matched, and a server action posted
// from a site machine on the LAN address was rejected. Pages load, forms fail
// silently, and it reads like a broken form rather than a config mismatch.
//
// Checked with Next's own matcher rather than assumed:
//   isCsrfOriginAllowed("192.168.8.200:3300", [...old list...]) === false
//   isCsrfOriginAllowed("192.168.8.200:3300", [...this list...]) === true
//
// A wildcard matches exactly one label, so "*.ec-workshops.online" covers
// fuelsystem.ec-workshops.online but not the bare apex.
const ALLOWED_ORIGINS = [
  // Production, through Cloudflare. Named literally as well as covered by the
  // wildcard below, so narrowing the wildcard later cannot silently kill every
  // form in production.
  "fuelsystem.ec-workshops.online",
  "fuel.portal.ec-workshops.online",
  "fuel-portal.ec-workshops.online",
  "*.ec-workshops.online",
  "*.portal.ec-workshops.online",
  // Local. The bare entry covers the default-port case; the second covers a
  // browser that sends the port, which it does whenever the port is not 80/443.
  "localhost",
  `localhost:${PORT}`,
  // Site machines reach the server by LAN address, not by name.
  `192.168.8.200:${PORT}`,
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ALLOWED_ORIGINS,
  experimental: {
    serverActions: {
      // Correction requests carry a signed running-chart photo/PDF.
      bodySizeLimit: "12mb",
      allowedOrigins: ALLOWED_ORIGINS,
    },
  },
};

export default nextConfig;
