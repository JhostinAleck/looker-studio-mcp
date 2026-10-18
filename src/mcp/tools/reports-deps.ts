import type { ReportRepository } from '@/contexts/reports/domain/ReportRepository.js';

export interface ReportToolDeps {
  reportRepo: ReportRepository;
  defaultProject: string | undefined;
}
