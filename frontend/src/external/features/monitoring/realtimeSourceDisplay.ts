import type { TFunction } from 'i18next';
import type { MonitoringEventRow } from '@/external/features/monitoring/hooks/useMonitoringData';

const hasReadableRealtimeValue = (value: string | null | undefined) => {
  const trimmed = String(value || '').trim();
  return !!(trimmed && trimmed !== '-');
};

/**
 * Legacy display function (used by MonitoringCenterPage).
 * Returns { primary, meta } — dynamic fallback chain, single primary + one meta line.
 */
export const buildRealtimeSourceDisplayLegacy = (
  row: Pick<
    MonitoringEventRow,
    | 'account'
    | 'accountMasked'
    | 'authLabel'
    | 'channel'
    | 'channelHost'
    | 'provider'
    | 'sourceMasked'
  >,
  t: TFunction
) => {
  const channel = hasReadableRealtimeValue(row.channel) ? row.channel.trim() : '';
  const provider = hasReadableRealtimeValue(row.provider) ? row.provider.trim() : '';
  const host = hasReadableRealtimeValue(row.channelHost) ? row.channelHost.trim() : '';
  const account = [row.account, row.authLabel, row.accountMasked]
    .find(hasReadableRealtimeValue)
    ?.trim();
  const source = hasReadableRealtimeValue(row.sourceMasked) ? row.sourceMasked.trim() : '';
  const primary = channel || provider || host || account || source || '-';
  const metaCandidate = [
    { value: provider, label: t('monitoring.filter_provider') },
    { value: host, label: t('monitoring.column_host') },
    { value: account, label: '' },
    { value: source, label: t('monitoring.source') },
  ].find((candidate) => candidate.value && candidate.value !== primary);
  const meta =
    metaCandidate && metaCandidate.label
      ? `${metaCandidate.label}: ${metaCandidate.value}`
      : metaCandidate?.value || '';

  return {
    primary,
    meta,
  };
};

/**
 * Masked key formatter: m:sk-I...aYYwzR → sk-I******aYYwzR
 * Deducts the 'm:' prefix and replaces '...' with 6 asterisks.
 */
const formatMaskedApiKey = (raw: string | null | undefined): string => {
  if (!raw || raw === '-') return '-';

  const trimmed = String(raw).trim();
  if (!trimmed.startsWith('m:')) return '-';

  const rest = trimmed.slice(2);
  if (rest === '****') return '-';

  if (rest.length <= 10) {
    return rest;
  }

  const prefix = rest.slice(0, 4);
  const suffix = rest.slice(-6);
  return `${prefix}******${suffix}`;
};

/**
 * 从字符串中提取 host (eg. "https://hub.oaifree.com/v1" → "hub.oaifree.com")
 * 用于当 baseHost 缺失时从 channel/provider 名称里推断
 */
const extractHostFromString = (text: string): string => {
  if (!text) return '';
  const urlMatch = text.match(/https?:\/\/([^/\s]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].replace(/^www\./, '');
  }
  return '';
};

/**
 * New display function for RequestMonitorPage.
 * Fixed 3-line structure:
 *   Line 1: provider (channel → provider → '-')
 *   Line 2: baseHost (HOST address — 多重 fallback)
 *   Line 3: account (账号标识)
 *   + tooltip with secondary info
 */
export const buildRealtimeSourceDisplay = (
  row: MonitoringEventRow,
  _t: TFunction
) => {
  const channel = hasReadableRealtimeValue(row.channel) ? row.channel.trim() : '';
  const provider = hasReadableRealtimeValue(row.provider) ? row.provider.trim() : '';
  const rawHost = hasReadableRealtimeValue(row.channelHost) ? row.channelHost.trim() : '';
  const apiKeyRaw = hasReadableRealtimeValue(row.apiKeyMasked) ? row.apiKeyMasked.trim() : '-';
  const apiKeyFormatted = formatMaskedApiKey(apiKeyRaw);
  const account = readableAccount(row.account, row.authLabel, row.accountMasked) || '-';

  const providerDisplay = channel || provider || '-';

  // HOST fallback 链：channelHost → 从 channel 名解析 → 从 provider 解析 → '-'
  const host = rawHost ||
    extractHostFromString(channel) ||
    extractHostFromString(provider) ||
    '-';

  const tooltip = [
    `渠道: ${channel || '-'}`,
    `提供商: ${provider || '-'}`,
    `Host: ${host}`,
    `账号: ${account}`,
    `API Key Hash: ${row.apiKeyHash ? `${row.apiKeyHash.slice(0, 8)}...` : '-'}`,
    `Auth Index: ${row.authIndex || '-'}`,
  ].join('\n');

  return {
    provider: providerDisplay,
    baseHost: host,
    account,
    apiKeyMasked: apiKeyFormatted,
    tooltip,
  };
};

/**
 * 判断并返回可读的账号标识
 * 优先级：auth account → auth label → 源显示文本
 * 排除明显的占位符（'-' / 空字符串）
 */
const readableAccount = (
  account: string,
  authLabel: string,
  accountMasked: string
): string | null => {
  const candidates = [account, authLabel, accountMasked];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed === '-') continue;
    return trimmed;
  }
  return null;
};
