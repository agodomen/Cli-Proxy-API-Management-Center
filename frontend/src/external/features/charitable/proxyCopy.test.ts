import { describe, expect, it } from 'vitest';
import {
  buildProxyCopyContent,
  isProxyCopyFormatAvailable,
} from './proxyCopy';

describe('proxy copy content', () => {
  it('copies multiple proxy URIs as separate lines', () => {
    expect(buildProxyCopyContent('uri', [' http://one:80 ', '', 'socks5://two:1080'])).toBe(
      'http://one:80\nsocks5://two:1080',
    );
  });

  it('builds Linux environment exports', () => {
    expect(buildProxyCopyContent('linux', ["http://u:p'ass@example.com:80"])).toBe(
      "export HTTP_PROXY='http://u:p'\\''ass@example.com:80'\n"
      + "export HTTPS_PROXY='http://u:p'\\''ass@example.com:80'\n"
      + "export ALL_PROXY='http://u:p'\\''ass@example.com:80'",
    );
  });

  it('builds CMD environment commands', () => {
    expect(buildProxyCopyContent('cmd', ['http://example.com:80'])).toBe(
      'set "HTTP_PROXY=http://example.com:80"\r\n'
      + 'set "HTTPS_PROXY=http://example.com:80"\r\n'
      + 'set "ALL_PROXY=http://example.com:80"',
    );
  });

  it('builds PowerShell environment commands', () => {
    expect(buildProxyCopyContent('powershell', ["http://p'ass@example.com:80"])).toContain(
      "$env:HTTP_PROXY = 'http://p''ass@example.com:80'",
    );
  });

  it('builds Fish environment commands', () => {
    expect(buildProxyCopyContent('fish', ["http://p'ass@example.com:80"])).toContain(
      "set -gx HTTP_PROXY 'http://p\\'ass@example.com:80'",
    );
  });

  it('builds Nushell environment commands', () => {
    expect(buildProxyCopyContent('nushell', ["http://p'ass@example.com:80"])).toContain(
      "$env.HTTP_PROXY = 'http://p''ass@example.com:80'",
    );
  });

  it('only enables environment commands for one proxy', () => {
    const values = ['http://one:80', 'http://two:80'];
    expect(isProxyCopyFormatAvailable('uri', values)).toBe(true);
    expect(isProxyCopyFormatAvailable('linux', values)).toBe(false);
    expect(() => buildProxyCopyContent('linux', values)).toThrow('single_proxy_required');
  });
});
