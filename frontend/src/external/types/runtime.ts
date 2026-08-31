/**
 * Server runtime kind detection — secondary-development extension.
 * The community version.ts/client.ts don't include runtime kind detection;
 * this module adds it for the secondary-dev LogsPage.
 */

export type ServerRuntimeKind = 'unknown' | 'cpa' | 'home';
