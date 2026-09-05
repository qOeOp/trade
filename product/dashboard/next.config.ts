import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dashboardDirectory = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  devIndicators: false,
  trailingSlash: true,
  turbopack: {
    root: resolve(dashboardDirectory, "../.."),
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
