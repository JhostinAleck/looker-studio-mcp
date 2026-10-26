import { describe, expect, it } from 'vitest';

import {
  DataSourceInUseError,
  DataSourceNotFoundError,
  chartsUsing,
  fieldTypePath,
  findDataSource,
  isUsed,
  parseConnectionChanges,
  parseConsoleLink,
  parseFreshness,
  validateDataSourceChange,
  validateFieldChange,
} from '@/contexts/reports/domain/DataSource.js';
import { InvalidChartError } from '@/contexts/reports/domain/Report.js';

const row = (name: string, alias: string, usedIn = '0 charts, 0 variables') => ({
  name,
  alias,
  connector: 'BigQuery',
  scope: 'Embedded',
  usedIn,
  status: 'Working',
});

const rows = [row('events', 'ds0'), row('Events by day', 'ds1'), row('Events by day', 'ds2')];

describe('data sources', () => {
  it('finds a data source by name or alias', () => {
    expect(findDataSource(rows, 'events').alias).toBe('ds0');
    expect(findDataSource(rows, 'DS2').alias).toBe('ds2');
    expect(findDataSource(rows, ' ds1 ').alias).toBe('ds1');
  });

  it('asks for the alias when a name repeats, and lists what exists when nothing matches', () => {
    expect(() => findDataSource(rows, 'Events by day')).toThrow(/ds1, ds2.*alias/);
    expect(() => findDataSource(rows, 'nope')).toThrow(DataSourceNotFoundError);
    expect(() => findDataSource(rows, 'nope')).toThrow(/events \(ds0\)/);
  });

  it('reads how many charts and variables use a data source', () => {
    expect(chartsUsing('1 chart, 0 variables')).toBe(1);
    expect(chartsUsing('12 charts, 3 variables')).toBe(12);
    expect(chartsUsing('')).toBe(0);
    expect(isUsed('0 charts, 0 variables')).toBe(false);
    expect(isUsed('0 charts, 1 variable')).toBe(true);
  });

  it('explains a refused removal', () => {
    const err = new DataSourceInUseError(row('events', 'ds0', '2 charts, 0 variables'));
    expect(err.userMessage).toMatch(/"events" \(ds0\).*2 charts.*force: true/);
  });

  it('parses the console links of the BigQuery connector', () => {
    expect(
      parseConsoleLink(
        'https://console.cloud.google.com/bigquery?project=p1&p=p1&d=analytics&t=events&page=table',
      ),
    ).toEqual({ project: 'p1', dataset: 'analytics', table: 'events' });
    expect(
      parseConsoleLink('https://console.cloud.google.com/bigquery?project=p1&page=project'),
    ).toEqual({
      project: 'p1',
    });
    expect(parseConsoleLink('')).toEqual({});
  });

  it('lists the field changes of a reconnect', () => {
    const text = [
      'Apply Connection Changes',
      'New Fields',
      'users',
      'Missing Fields',
      'feature',
      'Changed Semantic Configuration',
      'events',
      'Cancel',
      'Apply',
    ].join('\n');
    expect(parseConnectionChanges(text)).toEqual([
      'New fields: users',
      'Missing fields: feature',
      'Fields with a new type: events',
    ]);
    expect(parseConnectionChanges('No changes\nCancel')).toEqual([]);
  });

  it('validates data source changes', () => {
    expect(() => validateDataSourceChange({})).toThrow(InvalidChartError);
    expect(() => validateDataSourceChange({ name: ' ' })).toThrow(/name/);
    expect(() => validateDataSourceChange({ sql: '' })).toThrow(/SQL/);
    expect(validateDataSourceChange({ name: ' Sales ', freshness: '1 hour' })).toEqual({
      name: 'Sales',
      freshness: '1 hour',
    });
  });

  it('parses presets and custom data freshness periods', () => {
    expect(parseFreshness('4 hours')).toEqual({ preset: '4 hours' });
    expect(parseFreshness('1 hour')).toEqual({ preset: '1 hour' });
    expect(parseFreshness('30 minutes')).toEqual({ custom: { amount: 30, unit: 'minutes' } });
    expect(parseFreshness('every 2 hours')).toEqual({ custom: { amount: 2, unit: 'hours' } });
    expect(() => parseFreshness('1 day')).toThrow(/12 hours/);
    expect(() => parseFreshness('13 hours')).toThrow(InvalidChartError);
    expect(() => parseFreshness('7 minutes')).toThrow(/7 minutes/);
    expect(() => parseFreshness('soon')).toThrow(InvalidChartError);
    expect(validateDataSourceChange({ freshness: '2 h' })).toEqual({ freshness: '2 hours' });
    expect(validateDataSourceChange({ makeReusable: true })).toEqual({ makeReusable: true });
    expect(() => validateDataSourceChange({ name: 'x', grantEditorAccess: false })).toThrow(
      /make_reusable/,
    );
  });

  it('validates field changes and splits type paths', () => {
    expect(() => validateFieldChange('', { type: 'Number' })).toThrow(/field/);
    expect(() => validateFieldChange('events', {})).toThrow(/type, aggregation or name/);
    expect(validateFieldChange(' events ', { type: ' Number ', aggregation: 'sum' })).toEqual({
      type: 'Number',
      aggregation: 'sum',
    });
    expect(fieldTypePath('Number')).toEqual(['Number']);
    expect(fieldTypePath('Currency > EUR')).toEqual(['Currency', 'EUR']);
    expect(fieldTypePath('Date & Time › Year Month')).toEqual(['Date & Time', 'Year Month']);
  });
});
