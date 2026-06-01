import { describe, expect, it } from 'vitest';
import { buildClashVergeScript, proxyDetailToClash } from './clashVergeExport';
import type { ProxyDetail } from './types';

const proxy = (
  id: number,
  value: string,
  priority: number,
  proxyInfo = ''
): ProxyDetail => ({
  id,
  proxy_index: String(id),
  proxy_type: 5,
  proxy_value: value,
  proxy_info: proxyInfo,
  status: 1,
  priority,
  param: '{}',
  create_at: '',
  update_at: '',
});

describe('Clash Verge export', () => {
  it('parses authenticated HTTP proxies', () => {
    expect(proxyDetailToClash(proxy(1, 'http://user:pass@127.0.0.1:3128', 0))).toMatchObject({
      type: 'http',
      server: '127.0.0.1',
      port: 3128,
      username: 'user',
      password: 'pass',
    });
  });

  it('classifies by proxy_info.privacy and skips local', () => {
    const result = buildClashVergeScript([
      proxy(1, 'http://a:b@1.1.1.1:80', 0, '{"privacy":"public"}'),
      proxy(2, 'http://c:d@2.2.2.2:81', 0, '{"privacy":"personal"}'),
      proxy(3, 'http://e:f@3.3.3.3:82', 0, '{"privacy":"local"}'),
    ]);
    expect(result).toMatchObject({ publicCount: 1, personalCount: 1, skippedCount: 1 });
    expect(result.code).toContain('const publicProxies');
    expect(result.code).toContain('const personalProxies');
    expect(result.code).toContain('1.1.1.1');
    expect(result.code).toContain('2.2.2.2');
    expect(result.code).not.toContain('3.3.3.3');
  });

  it('falls back to priority for legacy rows without privacy metadata', () => {
    const result = buildClashVergeScript([
      proxy(1, 'http://a:b@1.1.1.1:80', -1, 'legacy'),
      proxy(2, 'http://c:d@2.2.2.2:81', 0, 'legacy'),
    ]);
    expect(result).toMatchObject({ publicCount: 1, personalCount: 1, skippedCount: 0 });
  });
});
