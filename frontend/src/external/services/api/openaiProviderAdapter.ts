import { providersApi } from '@/external/services/api/providersExt';
import type { OpenAIProviderConfig } from '@/types';

/**
 * 适配器：社区删除了 updateOpenAIProvider，用 saveOpenAIProviders 替代
 */
export async function updateOpenAIProvider(index: number, value: OpenAIProviderConfig): Promise<void> {
  const providers = await providersApi.getOpenAIProviders();
  const updated = [...providers];
  updated[index] = value;
  await providersApi.saveOpenAIProviders(updated);
}
