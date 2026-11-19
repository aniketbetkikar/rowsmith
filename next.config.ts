import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // BullMQ loads Lua scripts from disk at runtime; keep it (and its Redis
  // client) out of the server bundle. mongodb and pino are external by default.
  serverExternalPackages: ["bullmq", "ioredis"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
