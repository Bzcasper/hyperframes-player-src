/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/render": ["./public/compositions/**/*"],
  },
};

export default nextConfig;
