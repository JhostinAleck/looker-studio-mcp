import type { BigQuerySource } from './Report.js';
import { InvalidChartError } from './Report.js';

// Report-level operations of the Looker Studio editor: copies, link sharing,
// scheduled email delivery, version history and embedding.

// Make a copy: a data source of the original (by name) gets a new connection in the copy.
export interface DataSourceReplacement {
  original: string;
  source: BigQuerySource;
}

export interface CopiedReport {
  id: string;
  name: string;
  url: string;
  // Data sources reconnected in the copy, as "original → new name".
  replaced: string[];
}

// Share › Link settings: Restricted (people added), Unlisted (anyone with the
// link) or Public (anyone on the internet can find it).
export const LINK_ACCESS = ['restricted', 'unlisted', 'public'] as const;
export type LinkAccess = (typeof LINK_ACCESS)[number];

export interface LinkSharing {
  access: LinkAccess;
  // What people with the link can do; Restricted has none.
  role?: 'viewer' | 'editor';
}

export const REPEATS = ['daily', 'weekly', 'monthly', 'weekdays', 'custom'] as const;
export type Repeat = (typeof REPEATS)[number];

export interface DeliverySchedule {
  // Extra recipients; the signed-in account always gets the email too.
  recipients: string[];
  // YYYY-MM-DD; Looker Studio defaults to today.
  startDate?: string;
  // HH:MM, 24 h, on the hour or half hour, in the report owner's time zone.
  time?: string;
  // weekly and monthly follow the start date (weekly on its weekday,
  // monthly on the same week and weekday of the month).
  repeat?: Repeat;
  // repeat: custom — every `interval` days, weeks or months.
  every?: { interval: number; unit: 'day' | 'week' | 'month' };
  // Page names; all pages when omitted.
  pages?: string[];
}

// What the Schedule delivery dialog shows for a scheduled report, by label
// (From, To, Pages, Start Date, Repeat, Time, Timezone).
export type DeliveryInfo = Record<string, string>;

export interface ReportVersion {
  // 1-based position in File › Version history; 1 is the current version.
  index: number;
  // The version's name, or its date and time when it has none.
  label: string;
  current: boolean;
  authors: string[];
}

export interface EmbedOptions {
  page?: number;
  width?: number;
  height?: number;
  showNavigation?: boolean;
}

export interface EmbedInfo {
  code: string;
  url: string;
  // True when this call turned embedding on.
  enabled: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The schedule date box takes "Oct 23, 2026".
export function scheduleDateLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const date = match ? new Date(Date.UTC(year!, month! - 1, day)) : null;
  if (!date || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) {
    throw new InvalidChartError(`start_date must be a date as YYYY-MM-DD, not "${iso}".`);
  }
  return `${MONTHS[month! - 1]} ${day}, ${year}`;
}

// The schedule time list has half-hour slots labelled "9:30 AM".
export function scheduleTimeLabel(time: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hour = Number(match?.[1]);
  const minute = match?.[2];
  if (!match || hour > 23 || (minute !== '00' && minute !== '30')) {
    throw new InvalidChartError(
      `time must be HH:MM on the hour or half hour (e.g. 08:00, 17:30), not "${time}".`,
    );
  }
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${suffix}`;
}

// Repeat options are "Daily", "Weekly on Friday", "Monthly on the 4th Friday",
// "Every weekday (Monday to Friday)" and "Custom": matched by their start.
export const REPEAT_OPTION: Record<Repeat, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  weekdays: 'Every weekday',
  custom: 'Custom',
};

export function validateSchedule(schedule: DeliverySchedule): void {
  const bad = schedule.recipients.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad.length) throw new InvalidChartError(`Not email addresses: ${bad.join(', ')}.`);
  if (schedule.startDate !== undefined) scheduleDateLabel(schedule.startDate);
  if (schedule.time !== undefined) scheduleTimeLabel(schedule.time);
  if (schedule.every && schedule.repeat !== 'custom') {
    throw new InvalidChartError('every only applies to repeat: custom.');
  }
  if (schedule.repeat === 'custom') {
    const interval = schedule.every?.interval;
    if (!interval || !Number.isInteger(interval) || interval < 1) {
      throw new InvalidChartError('repeat: custom needs every.interval, a whole number from 1.');
    }
  }
  if (schedule.pages && !schedule.pages.length) {
    throw new InvalidChartError('pages needs at least one page name; omit it for all pages.');
  }
}

// A version by its 1-based index or its label (name or date as listed).
export function findVersion(
  versions: ReportVersion[],
  wanted: number | string,
): ReportVersion | undefined {
  if (typeof wanted === 'number') return versions.find((v) => v.index === wanted);
  const label = wanted.trim().toLowerCase();
  return (
    versions.find((v) => v.label.toLowerCase() === label) ??
    versions.find((v) => v.label.toLowerCase().includes(label))
  );
}
