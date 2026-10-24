import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Babylon.js ships ES modules; transpiling keeps tree-shaking predictable.
  transpilePackages: ["@babylonjs/core", "@babylonjs/loaders"],
  // The catalogue API reads JSON from /data at runtime; make sure serverless hosts bundle it.
  outputFileTracingIncludes: { "/api/catalogue": ["./data/**/*.json"] },
  async headers() {
    return [
      {
        // Demo textures are content-addressed by file name; cache aggressively.
        source: "/demo-assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

export default nextConfig;
