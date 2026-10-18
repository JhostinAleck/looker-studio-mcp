import { describe, expect, it } from 'vitest';

import {
  InvalidIdentifierError,
  assertName,
  assertProjectId,
  isReadOnlyQuery,
  quoteString,
  viewDdl,
} from '@/contexts/bigquery/domain/sql.js';

describe('isReadOnlyQuery', () => {
  it.each([
    'SELECT 1',
    'select * from `p.d.t` where op != "DELETE"',
    'WITH x AS (SELECT 1) SELECT * FROM x;',
    'SELECT created_at, update_time FROM t -- drop table t',
    "SELECT 'insert into' AS text",
  ])('accepts %s', (sql) => expect(isReadOnlyQuery(sql)).toBe(true));

  it.each([
    'DELETE FROM t WHERE true',
    'SELECT 1; DROP TABLE t',
    'CREATE VIEW v AS SELECT 1',
    'INSERT INTO t VALUES (1)',
    'WITH x AS (SELECT 1) MERGE t USING x ON true WHEN MATCHED THEN DELETE',
    '',
  ])('rejects %s', (sql) => expect(isReadOnlyQuery(sql)).toBe(false));
});

describe('identifiers', () => {
  it('accepts real project and dataset ids', () => {
    expect(assertProjectId('campusfind-26ac2')).toBe('campusfind-26ac2');
    expect(assertName('Dataset', 'campusfind_analytics')).toBe('campusfind_analytics');
  });

  it('rejects injection attempts', () => {
    expect(() => assertName('View', 'v`; DROP')).toThrow(InvalidIdentifierError);
    expect(() => assertProjectId('Bad_Project')).toThrow(InvalidIdentifierError);
  });
});

describe('viewDdl', () => {
  it('builds a CREATE OR REPLACE VIEW with an escaped description', () => {
    const ddl = viewDdl(
      { projectId: 'campusfind-26ac2', datasetId: 'a', tableId: 'v' },
      'SELECT 1;\n',
      "Jhostin's BQ",
    );
    expect(ddl).toBe(
      "CREATE OR REPLACE VIEW `campusfind-26ac2.a.v`\nOPTIONS (description = 'Jhostin\\'s BQ')\nAS\nSELECT 1",
    );
  });

  it('quotes newlines and backslashes', () => {
    expect(quoteString('a\\b\nc')).toBe("'a\\\\b\\nc'");
  });
});
