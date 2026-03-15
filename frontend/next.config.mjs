/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    // Needed for react-diff-viewer-continued (CommonJS module)
    esmExternals: "loose",
  },
};

export default nextConfig;
