/**
 * Self-contained types for serviceProviders feature.
 * Minimal subset of ProviderResource/ProviderEntryFormInput needed for openaiCompatibility.
 */

export interface ProviderResourceFlags {
  cloakEnabled?: boolean;
  websockets?: boolean;
  forceModelMappings?: boolean;
  isPlaceholder?: boolean;
}

export interface ProviderResource {
  id: string;
  brand: 'openaiCompatibility';
  originalIndex: number;
  name: string | null;
  identifier: string;
  apiKeyPreview: string | null;
  apiKey: string | null;
  authIndex: string | null;
  baseUrl: string | null;
  proxyUrl: string | null;
  prefix: string | null;
  modelCount: number;
  headerCount: number;
  excludedModelCount: number;
  apiKeyEntryCount: number;
  disabled: boolean;
  flags: ProviderResourceFlags;
  selector: { brand: 'openaiCompatibility'; name: string; index: number };
  raw: unknown;
}

export interface ModelEntryInput {
  name: string;
  alias?: string;
  priority?: number;
  testModel?: string;
  image?: boolean;
  thinkingJson?: string;
}

export interface ApiKeyEntryInput {
  apiKey: string;
  existingApiKey?: string;
  proxyUrl: string;
  authIndex?: string;
}

export interface ProviderEntryFormInput {
  apiKey: string;
  name: string;
  baseUrl: string;
  proxyUrl: string;
  prefix: string;
  disabled: boolean;
  disableCooling?: boolean;
  priority?: number;
  models: ModelEntryInput[];
  headers: Array<{ key: string; value: string }>;
  excludedModelsText: string;
  testModel?: string;
  apiKeyEntries?: ApiKeyEntryInput[];
}
