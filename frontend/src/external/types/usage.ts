/**
 * Usage 公共类型
 * 从 features/monitoring/hooks/useUsageData 中提取，避免跨阶段循环依赖
 */

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, unknown>;
  [key: string]: unknown;
}
