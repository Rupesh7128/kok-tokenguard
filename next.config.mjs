/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Drop-in base URL: point an OpenAI client at http://host:3000/v1
  async rewrites() {
    return [{ source: "/v1/chat/completions", destination: "/api/v1/chat/completions" }];
  },
};

export default nextConfig;
