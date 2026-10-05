import { defineConfig, loadEnv, type Plugin, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'

type VitestConfigShape = {
  environment: string
  globals: boolean
  setupFiles: string
  include: string[]
  exclude: string[]
}

function manualChunks(id: string): string | undefined {
  if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) return 'vendor-react'
  if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) return 'vendor-map'
  if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) return 'vendor-i18n'
  if (id.includes('node_modules/recharts')) return 'vendor-charts'
  return undefined
}

function normalizeSiteUrl(value?: string) {
  const candidate = (value || 'https://crisis-platform.com').trim() || 'https://crisis-platform.com'
  return candidate.replace(/\/+$/, '')
}

function buildRobotsTxt({
  siteUrl,
  allowIndexing,
  blockAiCrawlers,
}: {
  siteUrl: string
  allowIndexing: boolean
  blockAiCrawlers: boolean
}) {
  const lines = [
    'User-agent: *',
    allowIndexing ? 'Allow: /' : 'Disallow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /uploads/',
    'Disallow: /login',
    'Disallow: /signup',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    'Disallow: /account',
    'Disallow: /queue',
    'Disallow: /submit',
    'Disallow: /confirmation',
    'Disallow: /reports/',
  ]

  if (blockAiCrawlers) {
    const aiAgents = [
      'GPTBot',
      'ChatGPT-User',
      'Google-Extended',
      'ClaudeBot',
      'Claude-Web',
      'anthropic-ai',
      'PerplexityBot',
      'Bytespider',
      'CCBot',
      'Applebot-Extended',
      'Amazonbot',
      'OAI-SearchBot',
    ]

    aiAgents.forEach((agent) => {
      lines.push('', `User-agent: ${agent}`, 'Disallow: /')
    })
  }

  lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`)
  return `${lines.join('\n')}\n`
}

function buildSitemapXml(siteUrl: string) {
  const routes = [
    { path: '/', changefreq: 'daily', priority: '1.0' },
    { path: '/map', changefreq: 'hourly', priority: '0.8' },
    { path: '/news', changefreq: 'daily', priority: '0.7' },
  ]
  const lastmod = new Date().toISOString()
  const body = routes.map((route) => `  <url>
    <loc>${siteUrl}${route.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`
}

function seoAssetPlugin(env: Record<string, string>): Plugin {
  const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL)
  const allowIndexing = env.VITE_SEO_ALLOW_INDEXING === 'true'
  const blockAiCrawlers = env.VITE_SEO_BLOCK_AI !== 'false'

  return {
    name: 'seo-assets',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: buildRobotsTxt({ siteUrl, allowIndexing, blockAiCrawlers }),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemapXml(siteUrl),
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const config = {
  plugins: [react(), seoAssetPlugin(env)],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: 'src/test/setup.ts',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**'],
  },
} satisfies UserConfig & { test: VitestConfigShape }

  return config
})
