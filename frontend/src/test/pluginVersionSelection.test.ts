import { describe, expect, test } from 'bun:test';
import { supportsPluginVersionSelection } from '../features/plugins/pluginReleaseVersions.ts';

describe('plugin version selection', () => {
  test('allows custom versions only for GitHub release installs', () => {
    expect(supportsPluginVersionSelection('github-release')).toBe(true);
    expect(supportsPluginVersionSelection(' GitHub-Release ')).toBe(true);
    expect(supportsPluginVersionSelection('direct')).toBe(false);
    expect(supportsPluginVersionSelection('')).toBe(false);
  });
});
