/**
 * Format utility extensions for CPAMC.
 * Re-exports Center's format utilities and adds CPA-specific ones.
 */

export { maskApiKey, formatFileSize, formatUnixTimestamp } from '@/utils/format';

/**
 * API Key 遮蔽匹配正则（用于脱敏显示）
 */
const API_KEY_MASK_REGEX =
  /(sk-proj-[A-Za-z0-9-_]{6,}|sk-ant-[A-Za-z0-9-_]{6,}|sk-[A-Za-z0-9-_]{6,}|sess-[A-Za-z0-9-_]{6,}|ghp_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z-_]{8,}|AI[a-zA-Z0-9_-]{6,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/g;

/**
 * 将文本中的 API Key 片段替换为脱敏显示
 */
export function maskSensitiveText(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.replace(API_KEY_MASK_REGEX, (match) => {
    // Reuse maskApiKey logic inline for bundled builds
    const visibleChars = match.length < 4 ? 1 : 2;
    const start = match.slice(0, visibleChars);
    const end = match.slice(-visibleChars);
    const maskedLength = Math.max(10 - visibleChars * 2, 1);
    return `${start}${'*'.repeat(maskedLength)}${end}`;
  });
}
