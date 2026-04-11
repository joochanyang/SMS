import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  serverExternalPackages: ["argon2"],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
