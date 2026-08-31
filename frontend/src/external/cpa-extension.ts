/**
 * CPA Extension entry point.
 *
 * Import this file once in main.tsx to:
 * 1. Inject external i18n language bundles
 * 2. Register external routes (via externalRoutes)
 * 3. Register external nav items (via externalNavGroups)
 * 4. Provide the secondary-dev MainLayout & MainRoutes
 * 5. Apply secondary-dev style overrides (after community styles)
 */

// Initialize i18n - injects external language bundles via addResourceBundle
import '@/external/i18n';

// Apply secondary-dev style overrides after community global styles
import '@/external/styles/layout-extension.scss';

// Re-export everything the bridge files need
export { externalRoutes } from './router/externalRoutes';
export { externalNavGroups } from './externalNav';
export { MainLayout } from './components/layout/MainLayout';
export { MainRoutes } from './router/MainRoutes';
