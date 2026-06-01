/**
 * CPA Extension entry point.
 *
 * Import this file once in main.tsx to:
 * 1. Inject external i18n language bundles
 * 2. Register external routes (via externalRoutes)
 * 3. Register external nav items (via externalNavGroups)
 */

// Initialize i18n - injects external language bundles via addResourceBundle
import '@/external/i18n';

// Re-export everything the bridge files need
export { externalRoutes } from './externalRoutes';
export { externalNavGroups } from './externalNav';
