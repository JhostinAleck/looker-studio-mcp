import { describe, expect, it, vi } from 'vitest';

import {
  copyReport,
  getEmbed,
  restoreVersion,
  scheduleDelivery,
  setLinkSharing,
} from '@/contexts/reports/application/reportUseCases.js';
import { InvalidChartError } from '@/contexts/reports/domain/Report.js';
import type { ReportRepository } from '@/contexts/reports/domain/ReportRepository.js';
import {
  type DeliveryControl,
  findVersion,
  pickDeliveryControl,
  scheduleDateLabel,
  scheduleTimeLabel,
  timeZoneOffset,
  validateSchedule,
} from '@/contexts/reports/domain/reportOps.js';

const ID = '1a2b3c4d-0000-4000-8000-1234567890ab';

function repo(): ReportRepository {
  return {
    copyReport: vi.fn(async () => ({ id: ID, name: 'Copy', url: 'u', replaced: [] })),
    setLinkSharing: vi.fn(async (_id: string, sharing: unknown) => sharing),
    scheduleDelivery: vi.fn(async () => ({})),
    restoreVersion: vi.fn(),
    getEmbed: vi.fn(),
  } as unknown as ReportRepository;
}

describe('schedule labels', () => {
  it('writes dates the way the date box shows them', () => {
    expect(scheduleDateLabel('2026-10-23')).toBe('Oct 23, 2026');
    expect(scheduleDateLabel('2027-01-05')).toBe('Jan 5, 2027');
  });

  it('refuses dates that do not exist', () => {
    expect(() => scheduleDateLabel('2026-02-30')).toThrow(InvalidChartError);
    expect(() => scheduleDateLabel('23/10/2026')).toThrow(InvalidChartError);
  });

  it('turns 24 h times into the half-hour slots', () => {
    expect(scheduleTimeLabel('00:00')).toBe('12:00 AM');
    expect(scheduleTimeLabel('9:30')).toBe('9:30 AM');
    expect(scheduleTimeLabel('12:00')).toBe('12:00 PM');
    expect(scheduleTimeLabel('17:30')).toBe('5:30 PM');
    expect(() => scheduleTimeLabel('17:15')).toThrow(InvalidChartError);
    expect(() => scheduleTimeLabel('24:00')).toThrow(InvalidChartError);
  });

  it('checks custom repeats and recipients', () => {
    expect(() => validateSchedule({ recipients: ['nope'] })).toThrow(/Not email/);
    expect(() => validateSchedule({ recipients: [], repeat: 'custom' })).toThrow(/every/);
    expect(() =>
      validateSchedule({ recipients: [], repeat: 'daily', every: { interval: 2, unit: 'day' } }),
    ).toThrow(/custom/);
    expect(() =>
      validateSchedule({ recipients: [], repeat: 'custom', every: { interval: 2, unit: 'week' } }),
    ).not.toThrow();
  });
});

describe('schedule options', () => {
  it('checks weekdays, monthly_on, time zones and filters', () => {
    const custom = (every: object) =>
      validateSchedule({
        recipients: [],
        repeat: 'custom',
        every: { interval: 2, ...every } as never,
      });
    expect(() => custom({ unit: 'week', weekdays: ['monday', 'thursday'] })).not.toThrow();
    expect(() => custom({ unit: 'day', weekdays: ['monday'] })).toThrow(/weekdays/);
    expect(() => custom({ unit: 'week', weekdays: [] })).toThrow(/at least one day/);
    expect(() => custom({ unit: 'week', monthlyOn: 'weekday' })).toThrow(/monthly_on/);
    expect(() => validateSchedule({ recipients: [], timeZone: 'Mars/Base' })).toThrow(/IANA/);
    expect(() =>
      validateSchedule({ recipients: [], filters: [{ field: 'f', dateRange: 'Last 7 days' }] }),
    ).toThrow(/not both/);
    expect(() => validateSchedule({ recipients: [], filters: [{ field: 'f' }] })).toThrow(/values/);
    expect(() =>
      validateSchedule({ recipients: [], filters: [{ dateRange: '2026-10-09..2026-10-01' }] }),
    ).toThrow(InvalidChartError);
    expect(() =>
      validateSchedule({ recipients: [], filters: [{ field: 'f', values: [], index: 0 }] }),
    ).toThrow(/index/);
  });

  it('writes zone offsets the way the dialog labels them', () => {
    const at = new Date('2026-10-26T12:00:00Z');
    expect(timeZoneOffset('Asia/Tokyo', at)).toBe('GMT+09:00');
    expect(timeZoneOffset('Asia/Kolkata', at)).toBe('GMT+05:30');
    expect(timeZoneOffset('America/Bogota', at)).toBe('GMT-05:00');
    expect(timeZoneOffset('UTC', at)).toBe('GMT+00:00');
  });

  it('finds the filter control a filter sets', () => {
    const c = (page: string, field: string, kind: DeliveryControl['kind']): DeliveryControl => ({
      page,
      field,
      kind,
      text: field,
    });
    const controls = [
      c('One', 'feature', 'list'),
      c('Two', '', 'date'),
      c('Two', 'platform', 'input'),
      c('Two', 'platform', 'list'),
      c('Two', 'feature', 'list'),
    ];
    expect(pickDeliveryControl(controls, { dateRange: 'Last 7 days' })).toMatchObject({
      page: 'Two',
      position: 0,
    });
    expect(
      pickDeliveryControl(controls, { page: 'Two', field: 'platform', index: 2, values: [] }),
    ).toMatchObject({ page: 'Two', position: 2, control: { kind: 'list' } });
    expect(() => pickDeliveryControl(controls, { field: 'platform', values: [] })).toThrow(/index/);
    expect(() => pickDeliveryControl(controls, { field: 'feature', values: [] })).toThrow(
      /pass page/,
    );
    expect(
      pickDeliveryControl(controls, { page: 'One', field: 'Feature', values: [] }).position,
    ).toBe(0);
    expect(() => pickDeliveryControl(controls, { field: 'nope', values: [] })).toThrow(/it has/);
  });
});

describe('findVersion', () => {
  const versions = [
    { index: 1, label: 'October 21, 2026 7:43 PM', current: true, authors: [] },
    { index: 2, label: 'Launch', current: false, authors: ['Ana'] },
    { index: 3, label: 'October 21, 2026 7:07 PM', current: false, authors: ['Ana'] },
  ];

  it('finds a version by index, label or part of its date', () => {
    expect(findVersion(versions, 3)?.label).toBe('October 21, 2026 7:07 PM');
    expect(findVersion(versions, 'launch')?.index).toBe(2);
    expect(findVersion(versions, '7:07 PM')?.index).toBe(3);
    expect(findVersion(versions, 'nothing')).toBeUndefined();
  });
});

describe('report operation use cases', () => {
  it('copies under a trimmed name and refuses a source replaced twice', async () => {
    const r = repo();
    const source = { projectId: 'p', datasetId: 'd', tableId: 't' };
    await copyReport(r, ID, '  Copy  ', [{ original: 'a', source }]);
    expect(r.copyReport).toHaveBeenCalledWith(ID, 'Copy', [{ original: 'a', source }]);
    await expect(
      copyReport(r, ID, 'Copy', [
        { original: 'a', source },
        { original: 'a', source },
      ]),
    ).rejects.toThrow(/twice/);
    await expect(copyReport(r, ID, ' ', [])).rejects.toThrow(InvalidChartError);
    await copyReport(r, ID, 'Copy', [{ original: 'a', reusable: 'Shared sales' }]);
    await expect(copyReport(r, ID, 'Copy', [{ original: 'a', reusable: ' ' }])).rejects.toThrow(
      /reusable/,
    );
  });

  it('only gives a role to links anyone can open', async () => {
    await expect(
      setLinkSharing(repo(), ID, { access: 'restricted', role: 'editor' }),
    ).rejects.toThrow(InvalidChartError);
    await expect(
      setLinkSharing(repo(), ID, { access: 'unlisted', role: 'viewer' }),
    ).resolves.toEqual({
      access: 'unlisted',
      role: 'viewer',
    });
  });

  it('dedupes recipients before scheduling', async () => {
    const r = repo();
    await scheduleDelivery(r, ID, { recipients: ['A@x.com', 'a@x.com '], time: '08:00' });
    expect(r.scheduleDelivery).toHaveBeenCalledWith(ID, { recipients: ['a@x.com'], time: '08:00' });
  });

  it('never restores the current version', async () => {
    await expect(restoreVersion(repo(), ID, 1)).rejects.toThrow(/current/);
    await expect(restoreVersion(repo(), ID, ' ')).rejects.toThrow(InvalidChartError);
  });

  it('checks the embed size', async () => {
    await expect(getEmbed(repo(), ID, { width: 0 })).rejects.toThrow(/width/);
  });
});
