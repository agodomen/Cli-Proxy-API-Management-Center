/**
 * CPA Extension navigation items.
 * These are merged into Center's sidebar navigation via a spread operator.
 */

import { createElement, type ReactNode } from 'react';

export interface ExternalNavItem {
  path: string;
  labelKey: string;
  metaKey?: string;
  icon: ReactNode;
}

const navIcon = (...children: ReactNode[]) =>
  createElement(
    'svg',
    {
      width: 18,
      height: 18,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...children,
  );

const path = (d: string, extra: Record<string, unknown> = {}) =>
  createElement('path', { d, ...extra });
const circle = (cx: number, cy: number, r: number, extra: Record<string, unknown> = {}) =>
  createElement('circle', { cx, cy, r, ...extra });
const rect = (x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) =>
  createElement('rect', { x, y, width, height, ...extra });

const externalNavIcons = {
  monitoringCenter: navIcon(
    path('M3 12h3l2.2-4.5 4.2 9 2.4-5h6.2'),
    path('M4 19h16'),
    path('M4 5h16'),
  ),
  realtimeRequest: navIcon(path('M12 6v6l4 2'), circle(12, 12, 8)),
  inspection: navIcon(path('m3 21 6.5-6.5'), circle(11, 11, 6), path('m16 16 5 5')),
  serviceProviders: navIcon(
    rect(3, 4, 18, 6, { rx: 2 }),
    rect(3, 14, 18, 6, { rx: 2 }),
    path('M7 7h.01'),
    path('M7 17h.01'),
  ),
  charitableKeys: navIcon(circle(8, 15, 4), path('M12 15h8'), path('M17 13v4')),
  charitableProviders: navIcon(
    path('M4 20v-9l8-4 8 4v9'),
    path('M9 20v-4h6v4'),
    path('M12 7V4'),
  ),
  charitableProxies: navIcon(
    path('M4 4h16v4H4z'),
    path('M4 10h16v4H4z'),
    path('M4 16h10v4H4z'),
    rect(15, 16, 5, 4, { rx: 1 }),
  ),
  charitableChannels: navIcon(
    path('M5 7h14'),
    path('M5 12h14'),
    path('M5 17h14'),
    path('M9 5v4'),
    path('M15 10v4'),
    path('M9 15v4'),
  ),
  charitableDebug: navIcon(path('M10 2h4'), path('M12 14v4'), path('M4 13h16'), path('M6 13a6 6 0 1 1 12 0')),
  systemConfig: navIcon(
    circle(12, 12, 3),
    path('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'),
  ),
};

/**
 * External nav groups to append to Center's sidebar.
 * Uses i18n keys from the 'translation' namespace (injected at runtime).
 */
export const externalNavGroups = [
  {
    id: 'monitoring',
    labelKey: 'nav_groups.monitoring',
    items: [
      {
        path: '/monitoring',
        labelKey: 'nav.monitoring_center',
        metaKey: 'nav_meta.monitoring_center',
        icon: externalNavIcons.monitoringCenter,
      },
      {
        path: '/realtime/request',
        labelKey: 'nav.realtime_monitor',
        metaKey: 'nav_meta.realtime_monitor',
        icon: externalNavIcons.realtimeRequest,
      },
      {
        path: '/monitor/inspection',
        labelKey: 'nav.codex_inspection',
        metaKey: 'nav_meta.codex_inspection',
        icon: externalNavIcons.inspection,
      },
      {
        path: '/service-providers',
        labelKey: 'nav.service_providers',
        metaKey: 'nav_meta.service_providers',
        icon: externalNavIcons.serviceProviders,
      },
    ],
  },
  {
    id: 'charitable',
    labelKey: 'nav_groups.charitable',
    items: [
      {
        path: '/charitable/token',
        labelKey: 'nav.token_center',
        metaKey: 'nav_meta.token_center',
        icon: externalNavIcons.charitableKeys,
      },
      {
        path: '/charitable/proxies',
        labelKey: 'charitable.proxies',
        metaKey: 'nav_meta.charitable_proxies',
        icon: externalNavIcons.charitableProxies,
      },
      {
        path: '/charitable/debug',
        labelKey: 'charitable.debug.nav',
        metaKey: 'nav_meta.charitable_debug',
        icon: externalNavIcons.charitableDebug,
      },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav_groups.system',
    items: [
      {
        path: '/system/config',
        labelKey: 'nav.system_config',
        metaKey: 'nav_meta.system_config',
        icon: externalNavIcons.systemConfig,
      },
    ],
  },
];
