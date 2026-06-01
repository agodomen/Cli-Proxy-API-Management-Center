/**
 * CPA Extension i18n - 运行时注入增量语言包
 * 通过 addResourceBundle 注入，不修改 Center 原有 locale 文件
 */

import i18n from '@/i18n';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import ru from './locales/ru.json';

const namespaces = 'translation';

const mergeWithFallback = (
  fallback: Record<string, unknown>,
  localized: Record<string, unknown>
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...fallback };
  Object.entries(localized).forEach(([key, value]) => {
    const fallbackValue = merged[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      fallbackValue &&
      typeof fallbackValue === 'object' &&
      !Array.isArray(fallbackValue)
    ) {
      merged[key] = mergeWithFallback(
        fallbackValue as Record<string, unknown>,
        value as Record<string, unknown>
      );
      return;
    }
    merged[key] = value;
  });
  return merged;
};

function injectExternalI18n() {
  i18n.addResourceBundle('zh-CN', namespaces, zhCN, true, true);
  i18n.addResourceBundle('zh-TW', namespaces, mergeWithFallback(en, zhTW), true, true);
  i18n.addResourceBundle('en', namespaces, en, true, true);
  i18n.addResourceBundle('ru', namespaces, mergeWithFallback(en, ru), true, true);
}

injectExternalI18n();

export default i18n;
