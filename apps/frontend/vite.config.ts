import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

/**
 * Content-Security-Policy for the built app (dev needs Vite's inline styles and HMR socket).
 * A meta tag cannot set frame-ancestors; the host serving dist/ must send NO_FRAMING itself.
 */
function contentSecurityPolicy(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd());
  const origin = (url: string | undefined) => (url ? new URL(url).origin : null);
  const connect = [
    "'self'",
    origin(env['VITE_API_URL']) ?? 'http://localhost:3000',
    // Without VITE_WS_URL the client derives the socket host from the page at runtime.
    origin(env['VITE_WS_URL']) ?? 'ws: wss:',
  ];
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    // Vite inlines font subsets under 4 kB as data: URLs.
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

/** Clickjacking guard for dev and preview; production hosting has to send the same headers. */
const NO_FRAMING = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
};

export default defineConfig(({ mode }) => ({
  plugins: [vue(), tailwindcss(), contentSecurityPolicy(mode)],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    headers: NO_FRAMING,
    watch: {
      usePolling: true,
    },
  },
  preview: { headers: NO_FRAMING },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
