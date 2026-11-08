/** @type {import('next').NextConfig} */
const config = {
  // Shared contracts live alongside this standalone app in the monorepo.
  experimental: { externalDir: true },
};
export default config;
