import { describe, it, expect } from 'vitest';
import { remark } from 'remark';
import remarkBaseLinks, { prefixUrl } from '../src/plugins/remark-base-links';

describe('prefixUrl', () => {
  const cases: Array<{ name: string; url: string; base: string; want: string }> = [
    { name: 'base "/" leaves links unchanged', url: '/configuration/', base: '/', want: '/configuration/' },
    { name: 'sub-path base prefixes internal links', url: '/configuration/', base: '/dask-gateway-pack/', want: '/dask-gateway-pack/configuration/' },
    { name: 'prefixes image paths', url: '/img/example.png', base: '/dask-gateway-pack/', want: '/dask-gateway-pack/img/example.png' },
    { name: 'never rewrites external links', url: 'https://nebari.dev', base: '/dask-gateway-pack/', want: 'https://nebari.dev' },
    { name: 'never rewrites protocol-relative links', url: '//example.com/x', base: '/dask-gateway-pack/', want: '//example.com/x' },
    { name: 'never rewrites anchor-only links', url: '#section', base: '/dask-gateway-pack/', want: '#section' },
    { name: 'preserves anchors on internal links', url: '/configuration/#collector', base: '/dask-gateway-pack/', want: '/dask-gateway-pack/configuration/#collector' },
    { name: 'idempotent on already-prefixed links', url: '/dask-gateway-pack/configuration/', base: '/dask-gateway-pack/', want: '/dask-gateway-pack/configuration/' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(prefixUrl(c.url, c.base)).toBe(c.want);
    });
  }
});

describe('remarkBaseLinks plugin', () => {
  it('rewrites link and image urls in a markdown document', async () => {
    const md = 'See [Configuration](/configuration/) and ![img](/img/a.png) and [ext](https://nebari.dev)';
    const out = String(
      await remark().use(remarkBaseLinks, { base: '/dask-gateway-pack/' }).process(md),
    );
    expect(out).toContain('(/dask-gateway-pack/configuration/)');
    expect(out).toContain('(/dask-gateway-pack/img/a.png)');
    expect(out).toContain('(https://nebari.dev)');
  });

  it('is a no-op when base is "/"', async () => {
    const md = '[C](/configuration/)';
    const out = String(await remark().use(remarkBaseLinks, { base: '/' }).process(md));
    expect(out).toContain('(/configuration/)');
  });
});
