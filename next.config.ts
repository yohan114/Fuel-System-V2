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

// The hostnames this system is reached by, in production behind the reverse
// proxy and locally on the LAN. Kept in one array so the dev-origin list and the
// server-action list cannot drift apart — previously they were duplicated by
// hand and had to be edited twice.
const ALLOWED_ORIGINS = [
  "fuel.portal.ec-workshops.online",
  "https://fuel.portal.ec-workshops.online",
  "*.portal.ec-workshops.online",
  "https://*.portal.ec-workshops.online",
  "fuel-portal.ec-workshops.online",
  "https://fuel-portal.ec-workshops.online",
  "http://fuel-portal.ec-workshops.online",
  "*.ec-workshops.online",
  "https://*.ec-workshops.online",
  "http://*.ec-workshops.online",
  // Local and LAN access on the configured port. The bare "localhost" entry
  // covers the default-port case; the explicit ones cover a browser that sends
  // the port in the Origin header, which it does whenever the port is not 80/443.
  "localhost",
  `localhost:${PORT}`,
  `http://localhost:${PORT}`,
  `https://localhost:${PORT}`,
  // Site machines reach the server by LAN address, not by name.
  `http://192.168.8.200:${PORT}`,
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
