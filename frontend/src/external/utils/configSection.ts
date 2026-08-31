/**
 * Section-aware config fetch helper for secondary-development pages.
 *
 * The community useConfigStore.fetchConfig only accepts (forceRefresh?: boolean).
 * This helper wraps it to support fetching a specific config section:
 *
 *   fetchConfigSection('codex-api-key')              // cached, return section value
 *   fetchConfigSection('openai-compatibility', true) // force refresh, return section value
 *   fetchConfigSection(undefined, true)              // force refresh full Config
 */

import { useConfigStore } from '@/stores/useConfigStore';
import type { Config } from '@/types';
import type { RawConfigSection } from '@/types/config';

export function extractSectionValue(
  config: Config,
  section: RawConfigSection
): unknown {
  switch (section) {
    case 'debug':
      return config.debug;
    case 'proxy-url':
      return config.proxyUrl;
    case 'request-retry':
      return config.requestRetry;
    case 'quota-exceeded':
      return config.quotaExceeded;
    case 'request-log':
      return config.requestLog;
    case 'logging-to-file':
      return config.loggingToFile;
    case 'logs-max-total-size-mb':
      return config.logsMaxTotalSizeMb;
    case 'ws-auth':
      return config.wsAuth;
    case 'force-model-prefix':
      return config.forceModelPrefix;
    case 'routing/strategy':
      return config.routingStrategy;
    case 'api-keys':
      return config.apiKeys;
    case 'gemini-api-key':
      return config.geminiApiKeys;
    case 'codex-api-key':
      return config.codexApiKeys;
    case 'xai-api-key':
      return config.xaiApiKeys;
    case 'claude-api-key':
      return config.claudeApiKeys;
    case 'vertex-api-key':
      return config.vertexApiKeys;
    case 'openai-compatibility':
      return config.openaiCompatibility;
    case 'oauth-excluded-models':
      return config.oauthExcludedModels;
    default:
      return config.raw?.[section];
  }
}

export async function fetchConfigSection(
  section?: RawConfigSection,
  forceRefresh?: boolean
): Promise<unknown> {
  const config = await useConfigStore.getState().fetchConfig(forceRefresh);
  return section ? extractSectionValue(config, section) : config;
}
