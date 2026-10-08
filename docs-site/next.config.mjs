import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  basePath: '/trade',
  trailingSlash: true,
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1'],
  images: {
    unoptimized: true,
  },
};

export default withMDX(config);
