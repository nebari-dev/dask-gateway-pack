// docs/astro.config.mjs
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { nebari } from '@nebari/starlight';
import rehypeMermaid from 'rehype-mermaid';
import remarkBaseLinks from './src/plugins/remark-base-links';

// BASE and SITE are set by CI when deploying under a subpath
// (e.g. packs.nebari.dev/dask-gateway-pack/). Default '/' is the
// right thing for `astro dev` and local previews.
export default defineConfig({
  base: process.env.BASE || '/',
  site: process.env.SITE,
  integrations: [
    starlight({
      title: 'Dask Gateway Pack',
      description:
        'Multi-tenant Dask clusters for Nebari: wraps the upstream dask-gateway Helm chart, exposes its REST API through the shared Envoy Gateway via the NebariApp CRD, and keeps scheduler traffic and dashboards in-cluster for JupyterLab (data-science-pack) users.',
      // Shared Nebari identity (brand colors, fonts, logo, favicon, footer, GitHub link)
      // comes from the @nebari/starlight theme plugin. logoHref sets where the header logo
      // takes the reader when they click it — nebari.dev for the project's main site.
      plugins: [nebari({ logoHref: 'https://nebari.dev/' })],
      sidebar: [
        {
          label: 'Overview',
          items: [
            { label: 'Introduction', slug: 'index' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Quick Start', slug: 'quick-start' },
            { label: 'Architecture', slug: 'architecture' },
            { label: 'Using from the Data Science Pack', slug: 'consuming-from-data-science-pack' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Configuration', slug: 'configuration' },
            { label: 'NebariApp CRD', slug: 'nebariapp-crd-reference' },
            { label: 'Roadmap & Limitations', slug: 'roadmap' },
          ],
        },
      ],
    }),
  ],
  markdown: {
    // Turn Shiki off for mermaid so rehype-mermaid sees the raw graph source.
    syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] },
    remarkPlugins: [[remarkBaseLinks, { base: process.env.BASE || '/' }]],
    rehypePlugins: [[rehypeMermaid, { strategy: 'inline-svg' }]],
  },
});
