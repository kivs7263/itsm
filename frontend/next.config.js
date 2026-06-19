/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@total/ui-shell'],

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 's3.ap-northeast-2.amazonaws.com',
        pathname: '/**',
      },
    ],
  },

  env: {
    NEXT_PUBLIC_API_BASE:          process.env.NEXT_PUBLIC_API_BASE,
    NEXT_PUBLIC_ITSM_URL:          process.env.NEXT_PUBLIC_ITSM_URL,
    NEXT_PUBLIC_SA_URL:            process.env.NEXT_PUBLIC_SA_URL,
    NEXT_PUBLIC_GW_URL:            process.env.NEXT_PUBLIC_GW_URL,
    NEXT_PUBLIC_ADMIN_PORTAL_URL:  process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL,
  },

  experimental: {
    // App Router is stable in Next.js 14, no flag needed
  },
};

module.exports = nextConfig;
