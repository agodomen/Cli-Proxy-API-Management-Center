import { describe, expect, test } from 'bun:test';
import { hasModelAliasConflict } from '../components/modelAlias/aliasValidation.ts';

describe('model alias validation', () => {
  test('checks aliases case-insensitively while excluding the renamed node', () => {
    expect(hasModelAliasConflict(['Foo'], ' foo ')).toBe(true);
    expect(hasModelAliasConflict(['Foo'], 'foo', 'Foo')).toBe(false);
    expect(hasModelAliasConflict(['Foo', 'Bar'], 'FOO', 'Bar')).toBe(true);
  });
});
