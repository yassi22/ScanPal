import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BullMQ en IORedis draaien alleen op de server en horen niet in de bundle.
  serverExternalPackages: ["bullmq", "ioredis"],
  // Zet barrel-imports (import { X } from "@phosphor-icons/react") automatisch om
  // naar directe icon-imports, zodat een route niet de hele icon-set hoeft te
  // compileren. Scheelt fors in dev-compile en client-bundlegrootte.
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  webpack(config, { webpack }) {
    config.plugins.push(
      new webpack.IgnorePlugin({
        // BullMQ vangt deze optionele require zelf af; ScanPal gebruikt IORedis.
        resourceRegExp: /^@valkey\/valkey-glide$/,
      }),
    );

    return config;
  },
};

export default nextConfig;
