import type { NextConfig } from "next";

// Dynamic app: the sensor route computes fresh, query-driven data per request,
// so it must run on a Node/serverless host (Vercel), NOT a static export.
// Do not add `output: 'export'` — it disables dynamic route handlers and query
// strings, which this API depends on.
const nextConfig: NextConfig = {
    async headers() {
        return [
            {
                source: '/api/:path*',
                headers: [
                    { key: 'Access-Control-Allow-Origin', value: '*' },
                    { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
                ],
            },
        ]
    }
};



export default nextConfig;
