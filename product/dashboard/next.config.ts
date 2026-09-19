import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dashboardDirectory = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Where the build lands. Two Next processes in this directory share one build directory and the
  // second one dies, which is what happens whenever a browser suite spawns its own dev server
  // beside a dev server someone is already watching. The default is the standard directory, so
  // production builds, CI caches and the ordered chain's own preview are untouched; only a caller
  // that sets this moves out of the way.
  distDir: process.env.DASHBOARD_DIST_DIR ?? ".next",
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
