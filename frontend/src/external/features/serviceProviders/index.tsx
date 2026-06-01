/**
 * Self-contained serviceProviders feature module.
 *
 * Usage in CPAMC router (minimal change):
 *
 *   import { ServiceProvidersPage, registerServiceProvidersRoutes } from '@/features/serviceProviders';
 *   const routes = [...existingRoutes, ...registerServiceProvidersRoutes()];
 */
import type { RouteObject } from 'react-router-dom';
import { ServiceProvidersPage } from './ServiceProvidersPage';

export { ServiceProvidersPage };

/**
 * Returns route definitions to merge into the app router.
 * Only returns the path+element pairs — the caller decides where to splice them in.
 */
export function registerServiceProvidersRoutes(): RouteObject[] {
  return [
    {
      path: '/service-providers',
      element: <ServiceProvidersPage />,
    },
  ];
}
