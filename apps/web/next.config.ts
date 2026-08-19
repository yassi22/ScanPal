import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BullMQ en IORedis draaien alleen op de server en horen niet in de bundle.
  serverExternalPackages: ["bullmq", "ioredis"],
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
