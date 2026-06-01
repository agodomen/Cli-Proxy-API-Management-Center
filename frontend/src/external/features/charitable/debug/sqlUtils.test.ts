import { describe, expect, it } from 'vitest';
import {
  buildCountSql,
  buildSelectSql,
  buildTableCountsSql,
  formatSqlLoose,
  isWriteSql,
  rowsToCsv,
  stripSqlComments,
} from './sqlUtils';

describe('sqlUtils', () => {
  it('detects write vs read sql', () => {
    expect(isWriteSql('SELECT 1')).toBe(false);
    expect(isWriteSql('with x as (select 1) select * from x')).toBe(false);
    expect(isWriteSql('DELETE FROM t')).toBe(true);
    expect(isWriteSql('/* c */ INSERT INTO t VALUES (1)')).toBe(true);
    expect(isWriteSql('-- only comment')).toBe(false);
  });

  it('strips comments', () => {
    expect(stripSqlComments('SELECT 1 -- hi')).toContain('SELECT 1');
    expect(stripSqlComments('/*x*/SELECT 2')).toBe('SELECT 2');
  });

  it('builds helpers', () => {
    expect(buildSelectSql('cpa_channel_info')).toContain('cpa_channel_info');
    expect(buildCountSql('usage_events')).toContain('COUNT(*)');
    expect(buildTableCountsSql(['a', 'b'])).toContain('UNION ALL');
    expect(formatSqlLoose('a  b\n\n\nc')).toBe('a b\n\nc');
  });

  it('exports csv', () => {
    expect(rowsToCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\n1,"x,y"');
  });
});
