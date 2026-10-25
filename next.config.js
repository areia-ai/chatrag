/** @type {import('next').NextConfig} */
// Dynamically include remote image hosts used in production (Supabase storage, custom logos)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseHost = null;
try {
  if (SUPABASE_URL) supabaseHost = new URL(SUPABASE_URL).hostname;
} catch { }

function parseHost(url) {
  try { return url ? new URL(url).hostname : null; } catch { return null; }
}
const headerLogoHost = parseHost(process.env.NEXT_PUBLIC_HEADER_LOGO_URL);
const aiLogoHost = parseHost(process.env.NEXT_PUBLIC_AI_RESPONSE_LOGO_URL);

const remotePatterns = [
  { protocol: 'https', hostname: 'replicate.delivery', port: '', pathname: '/xezq/**' },
];
if (supabaseHost) {
  remotePatterns.push({ protocol: 'https', hostname: supabaseHost, port: '', pathname: '/storage/v1/object/public/**' });
}
if (headerLogoHost) {
  remotePatterns.push({ protocol: 'https', hostname: headerLogoHost, port: '', pathname: '/**' });
}
if (aiLogoHost) {
  remotePatterns.push({ protocol: 'https', hostname: aiLogoHost, port: '', pathname: '/**' });
}

const nextConfig = {
  // React Compiler is now a top-level option in Next.js 16
  reactCompiler: true,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"]
    }
  },
  // Note: eslint.ignoreDuringBuilds removed (deprecated in Next.js 16)
  // Configure ESLint ignoring via .eslintrc or eslint.config.js instead
  // Allow cross-origin requests from ngrok for development
  allowedDevOrigins: ["b5c771ad2e29.ngrok-free.app"],
  typescript: {
    // This will allow builds to complete even with TypeScript errors
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns,
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

module.exports = nextConfig; 
