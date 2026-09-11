import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@tournament/core'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        // Team links carry a private token in the path; never send a full URL to another site.
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};

export default nextConfig;
