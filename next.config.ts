import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "fuel-portal.ec-workshops.online",
    "https://fuel-portal.ec-workshops.online",
    "http://fuel-portal.ec-workshops.online",
    "*.ec-workshops.online",
    "https://*.ec-workshops.online",
    "http://*.ec-workshops.online",
    "localhost:6600",
    "localhost",
    "http://localhost:6600",
    "https://localhost:6600"
  ],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "fuel-portal.ec-workshops.online",
        "https://fuel-portal.ec-workshops.online",
        "http://fuel-portal.ec-workshops.online",
        "*.ec-workshops.online",
        "https://*.ec-workshops.online",
        "http://*.ec-workshops.online",
        "localhost:6600",
        "localhost",
        "http://localhost:6600",
        "https://localhost:6600"
      ],
    },
  },
};

export default nextConfig;

