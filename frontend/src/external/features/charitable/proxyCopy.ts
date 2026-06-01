export type ProxyCopyFormat = 'uri' | 'linux' | 'cmd' | 'powershell' | 'fish' | 'nushell';

export const PROXY_COPY_FORMATS: ProxyCopyFormat[] = [
  'uri',
  'linux',
  'cmd',
  'powershell',
  'fish',
  'nushell',
];

export function isProxyCopyFormatAvailable(format: ProxyCopyFormat, values: string[]): boolean {
  const normalized = normalizeProxyValues(values);
  return normalized.length > 0 && (format === 'uri' || normalized.length === 1);
}

export function buildProxyCopyContent(format: ProxyCopyFormat, values: string[]): string {
  const normalized = normalizeProxyValues(values);
  if (normalized.length === 0) return '';
  if (format === 'uri') return normalized.join('\n');
  if (normalized.length !== 1) throw new Error('single_proxy_required');

  const value = normalized[0];
  switch (format) {
    case 'linux':
      return buildAssignments('export ', '=', quotePosix(value));
    case 'cmd':
      return PROXY_ENV_NAMES.map((name) => `set "${name}=${escapeCmd(value)}"`).join('\r\n');
    case 'powershell':
      return PROXY_ENV_NAMES.map((name) => `$env:${name} = ${quotePowerShell(value)}`).join('\r\n');
    case 'fish':
      return PROXY_ENV_NAMES.map((name) => `set -gx ${name} ${quoteFish(value)}`).join('\n');
    case 'nushell':
      return PROXY_ENV_NAMES.map((name) => `$env.${name} = ${quoteNushell(value)}`).join('\n');
  }
}

const PROXY_ENV_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'] as const;

function normalizeProxyValues(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function buildAssignments(prefix: string, separator: string, value: string): string {
  return PROXY_ENV_NAMES.map((name) => `${prefix}${name}${separator}${value}`).join('\n');
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeCmd(value: string): string {
  return value.replace(/"/g, '^"');
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteFish(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function quoteNushell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
