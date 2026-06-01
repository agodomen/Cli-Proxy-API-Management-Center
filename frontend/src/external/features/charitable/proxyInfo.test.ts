import { describe, expect, it } from 'vitest';
import {
  formatProxyInfoPreview,
  parseProxyInfo,
  resolveProxyPrivacy,
  stringifyProxyInfo,
  withProxyPrivacy,
} from './proxyInfo';

describe('proxyInfo', () => {
  it('defaults privacy to public and preserves extra metadata', () => {
    expect(parseProxyInfo('')).toEqual({ privacy: 'public' });
    expect(parseProxyInfo('{"region":"jp"}')).toEqual({ region: 'jp', privacy: 'public' });
    expect(parseProxyInfo('{"privacy":"personal","owner":"a"}')).toEqual({
      privacy: 'personal',
      owner: 'a',
    });
  });

  it('wraps legacy plain text as note metadata', () => {
    expect(parseProxyInfo('local socks')).toEqual({ privacy: 'public', note: 'local socks' });
    expect(stringifyProxyInfo(parseProxyInfo('local socks'))).toContain('"note":"local socks"');
  });

  it('uses explicit privacy first and falls back to priority for legacy rows', () => {
    expect(
      resolveProxyPrivacy({ proxy_info: '{"privacy":"local"}', priority: -10 })
    ).toBe('local');
    expect(resolveProxyPrivacy({ proxy_info: 'socks5', priority: -1 })).toBe('public');
    expect(resolveProxyPrivacy({ proxy_info: 'socks5', priority: 0 })).toBe('personal');
  });

  it('updates privacy without dropping other keys', () => {
    expect(JSON.parse(withProxyPrivacy('{"privacy":"public","note":"x"}', 'personal'))).toEqual({
      note: 'x',
      privacy: 'personal',
    });
  });

  it('truncates preview text for table display', () => {
    const long = withProxyPrivacy(
      JSON.stringify({ privacy: 'public', note: 'abcdefghijklmnopqrstuvwxyz0123456789' }),
      'public'
    );
    const preview = formatProxyInfoPreview(long, 24);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(24);
  });
});
