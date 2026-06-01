/**
 * Ampcode (Amp CLI Integration) 类型定义
 * 从社区旧版本隔离至此，因为上游已删除相关类型
 */

export interface AmpcodeModelMapping {
  from: string;
  to: string;
}

export interface AmpcodeUpstreamApiKeyMapping {
  upstreamApiKey: string;
  apiKeys: string[];
}

export interface AmpcodeConfig {
  upstreamUrl?: string;
  upstreamApiKey?: string;
  upstreamApiKeys?: AmpcodeUpstreamApiKeyMapping[];
  modelMappings?: AmpcodeModelMapping[];
  forceModelMappings?: boolean;
}
