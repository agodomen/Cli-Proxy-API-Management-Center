/**
 * CPA Extension external routes.
 * These routes are merged into Center's MainRoutes via a spread operator.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

// Lazy-loaded pages using .then() to convert named exports to default exports
const AiProvidersPage = lazy(() => import('@/external/pages/AiProvidersPage').then(m => ({ default: m.AiProvidersPage })));
const ProvidersWorkbenchPage = lazy(() => import('@/external/features/providers/ProvidersWorkbenchPage').then(m => ({ default: m.ProvidersWorkbenchPage })));
const AiProvidersGeminiEditPage = lazy(() => import('@/external/pages/AiProvidersGeminiEditPage').then(m => ({ default: m.AiProvidersGeminiEditPage })));
const AiProvidersCodexEditPage = lazy(() => import('@/external/pages/AiProvidersCodexEditPage').then(m => ({ default: m.AiProvidersCodexEditPage })));
const AiProvidersClaudeEditLayout = lazy(() => import('@/external/pages/AiProvidersClaudeEditLayout').then(m => ({ default: m.AiProvidersClaudeEditLayout })));
const AiProvidersClaudeEditPage = lazy(() => import('@/external/pages/AiProvidersClaudeEditPage').then(m => ({ default: m.AiProvidersClaudeEditPage })));
const AiProvidersClaudeModelsPage = lazy(() => import('@/external/pages/AiProvidersClaudeModelsPage').then(m => ({ default: m.AiProvidersClaudeModelsPage })));
const AiProvidersVertexEditPage = lazy(() => import('@/external/pages/AiProvidersVertexEditPage').then(m => ({ default: m.AiProvidersVertexEditPage })));
const AiProvidersOpenAIEditLayout = lazy(() => import('@/external/pages/AiProvidersOpenAIEditLayout').then(m => ({ default: m.AiProvidersOpenAIEditLayout })));
const AiProvidersOpenAIEditPage = lazy(() => import('@/external/pages/AiProvidersOpenAIEditPage').then(m => ({ default: m.AiProvidersOpenAIEditPage })));
const AiProvidersOpenAIModelsPage = lazy(() => import('@/external/pages/AiProvidersOpenAIModelsPage').then(m => ({ default: m.AiProvidersOpenAIModelsPage })));
const AiProvidersAmpcodeEditPage = lazy(() => import('@/external/pages/AiProvidersAmpcodeEditPage').then(m => ({ default: m.AiProvidersAmpcodeEditPage })));
const MonitoringCenterPage = lazy(() => import('@/external/pages/MonitoringCenterPage').then(m => ({ default: m.MonitoringCenterPage })));
const ModelPricePage = lazy(() => import('@/external/pages/ModelPricePage').then(m => ({ default: m.ModelPricePage })));
const RequestMonitorPage = lazy(() => import('@/external/features/requestMonitor/RequestMonitorPage').then(m => ({ default: m.RequestMonitorPage })));
const CodexInspectionPage = lazy(() => import('@/external/pages/CodexInspectionPage').then(m => ({ default: m.CodexInspectionPage })));
const SystemConfigPage = lazy(() => import('@/external/pages/SystemConfigPage').then(m => ({ default: m.SystemConfigPage })));
const SystemOverviewPage = lazy(() => import('@/external/pages/SystemOverviewPage').then(m => ({ default: m.SystemOverviewPage })));
const ServiceProvidersPage = lazy(() => import('@/external/features/serviceProviders/ServiceProvidersPage').then(m => ({ default: m.ServiceProvidersPage })));
const ClusterSettingsPage = lazy(() => import('@/external/features/cluster/ClusterSettingsPage').then(m => ({ default: m.ClusterSettingsPage })));
const PluginStorePage = lazy(() => import('@/external/pages/PluginStorePage'));

// Charitable module pages
const CharitableLayout = lazy(() => import('@/external/features/charitable/CharitableLayout').then(m => ({ default: m.CharitableLayout })));
const TokenCenterPage = lazy(() => import('@/external/features/charitable/TokenCenterPage').then(m => ({ default: m.TokenCenterPage })));
const ProxiesPage = lazy(() => import('@/external/features/charitable/ProxiesPage').then(m => ({ default: m.ProxiesPage })));
const DebugPage = lazy(() => import('@/external/features/charitable/DebugPage').then(m => ({ default: m.DebugPage })));

// Wrap lazy components in Suspense
function SuspenseWrap({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

/**
 * CPA-specific routes that replace or extend Center's routes.
 * These are inserted BEFORE the catch-all '*' route.
 */
export const externalRoutes = [
  // AI Providers - CPA replaces Center's simplified page with full editing
  { path: '/auth/providers/gemini/new', element: <SuspenseWrap><AiProvidersGeminiEditPage /></SuspenseWrap> },
  { path: '/auth/providers/gemini/:index', element: <SuspenseWrap><AiProvidersGeminiEditPage /></SuspenseWrap> },
  { path: '/auth/providers/codex/new', element: <SuspenseWrap><AiProvidersCodexEditPage /></SuspenseWrap> },
  { path: '/auth/providers/codex/:index', element: <SuspenseWrap><AiProvidersCodexEditPage /></SuspenseWrap> },
  {
    path: '/auth/providers/claude/new',
    element: <SuspenseWrap><AiProvidersClaudeEditLayout /></SuspenseWrap>,
    children: [
      { index: true, element: <SuspenseWrap><AiProvidersClaudeEditPage /></SuspenseWrap> },
      { path: 'models', element: <SuspenseWrap><AiProvidersClaudeModelsPage /></SuspenseWrap> },
    ],
  },
  {
    path: '/auth/providers/claude/:index',
    element: <SuspenseWrap><AiProvidersClaudeEditLayout /></SuspenseWrap>,
    children: [
      { index: true, element: <SuspenseWrap><AiProvidersClaudeEditPage /></SuspenseWrap> },
      { path: 'models', element: <SuspenseWrap><AiProvidersClaudeModelsPage /></SuspenseWrap> },
    ],
  },
  { path: '/auth/providers/vertex/new', element: <SuspenseWrap><AiProvidersVertexEditPage /></SuspenseWrap> },
  { path: '/auth/providers/vertex/:index', element: <SuspenseWrap><AiProvidersVertexEditPage /></SuspenseWrap> },
  {
    path: '/auth/providers/openai/new',
    element: <SuspenseWrap><AiProvidersOpenAIEditLayout /></SuspenseWrap>,
    children: [
      { index: true, element: <SuspenseWrap><AiProvidersOpenAIEditPage /></SuspenseWrap> },
      { path: 'models', element: <SuspenseWrap><AiProvidersOpenAIModelsPage /></SuspenseWrap> },
    ],
  },
  {
    path: '/auth/providers/openai/:index',
    element: <SuspenseWrap><AiProvidersOpenAIEditLayout /></SuspenseWrap>,
    children: [
      { index: true, element: <SuspenseWrap><AiProvidersOpenAIEditPage /></SuspenseWrap> },
      { path: 'models', element: <SuspenseWrap><AiProvidersOpenAIModelsPage /></SuspenseWrap> },
    ],
  },
  { path: '/auth/providers/ampcode', element: <SuspenseWrap><AiProvidersAmpcodeEditPage /></SuspenseWrap> },
  { path: '/ai/providers', element: <SuspenseWrap><ProvidersWorkbenchPage /></SuspenseWrap> },
  { path: '/ai/providers/*', element: <SuspenseWrap><ProvidersWorkbenchPage /></SuspenseWrap> },
  { path: '/auth/providers', element: <SuspenseWrap><AiProvidersPage /></SuspenseWrap> },
  { path: '/auth/providers/*', element: <SuspenseWrap><AiProvidersPage /></SuspenseWrap> },

  // Monitoring pages
  { path: '/monitoring', element: <SuspenseWrap><MonitoringCenterPage /></SuspenseWrap> },
  { path: '/model/price', element: <SuspenseWrap><ModelPricePage /></SuspenseWrap> },
  { path: '/realtime/request', element: <SuspenseWrap><RequestMonitorPage /></SuspenseWrap> },
  { path: '/monitor/inspection', element: <SuspenseWrap><CodexInspectionPage /></SuspenseWrap> },
  { path: '/system/config', element: <SuspenseWrap><SystemConfigPage /></SuspenseWrap> },
  { path: '/system/overview', element: <SuspenseWrap><SystemOverviewPage /></SuspenseWrap> },
  { path: '/plugin/store', element: <SuspenseWrap><PluginStorePage /></SuspenseWrap> },
  { path: '/cluster/settings', element: <SuspenseWrap><ClusterSettingsPage /></SuspenseWrap> },
  { path: '/service-providers', element: <SuspenseWrap><ServiceProvidersPage /></SuspenseWrap> },
  { path: '/service-providers/*', element: <SuspenseWrap><ServiceProvidersPage /></SuspenseWrap> },

  // Charitable module → renamed to Token Center (merged keys/providers/channels)
  {
    path: '/charitable',
    element: <SuspenseWrap><CharitableLayout /></SuspenseWrap>,
    children: [
      { index: true, element: <Navigate to="token" replace /> },
      { path: 'token', element: <SuspenseWrap><TokenCenterPage /></SuspenseWrap> },
      { path: 'keys', element: <SuspenseWrap><TokenCenterPage /></SuspenseWrap> },
      { path: 'providers', element: <SuspenseWrap><TokenCenterPage /></SuspenseWrap> },
      { path: 'channels', element: <SuspenseWrap><TokenCenterPage /></SuspenseWrap> },
      { path: 'policy', element: <SuspenseWrap><TokenCenterPage /></SuspenseWrap> },
      { path: 'probe', element: <SuspenseWrap><TokenCenterPage /></SuspenseWrap> },
      { path: 'proxies', element: <SuspenseWrap><ProxiesPage /></SuspenseWrap> },
      { path: 'debug', element: <SuspenseWrap><DebugPage /></SuspenseWrap> },
    ],
  },
];
