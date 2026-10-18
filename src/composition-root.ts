import { GoogleAuthTokenProvider } from '@/contexts/authentication/infrastructure/GoogleAuthTokenProvider.js';
import { PlaywrightBrowserSession } from '@/contexts/authentication/infrastructure/PlaywrightBrowserSession.js';
import { RestBigQueryRepository } from '@/contexts/bigquery/infrastructure/RestBigQueryRepository.js';
import { GoogleApiClient } from '@/contexts/google-api/infrastructure/GoogleApiClient.js';
import { LookerStudioUiReportRepository } from '@/contexts/reports/infrastructure/LookerStudioUiReportRepository.js';
import type { ToolDeps } from '@/mcp/registry.js';
import { AuditLogger } from '@/shared-kernel/audit/AuditLogger.js';
import { Paths } from '@/shared-kernel/config/paths.js';
import type { Config } from '@/shared-kernel/config/schema.js';
import { StructuredLogger } from '@/shared-kernel/logging/StructuredLogger.js';
import { expandPath } from '@/shared-kernel/path/expandPath.js';
import { WritesGate } from '@/shared-kernel/writes/WritesGate.js';

export interface BuildOptions {
  config: Config;
  enableWritesFlag: boolean;
  headed?: boolean;
}

export interface Dependencies extends ToolDeps {
  dispose(): Promise<void>;
}

export function buildDependencies(opts: BuildOptions): Dependencies {
  const { config } = opts;
  const logger = new StructuredLogger(config.logging.level);
  const keyFile =
    config.auth.credentials === 'file' && config.auth.credentials_file
      ? expandPath(config.auth.credentials_file)
      : undefined;
  const tokens = new GoogleAuthTokenProvider(keyFile ? { keyFile } : {});
  const api = new GoogleApiClient({ tokens });
  const browser = new PlaywrightBrowserSession({
    profileDir: expandPath(config.auth.browser_profile_dir ?? Paths.browserProfileDir()),
    channel: config.auth.browser_channel,
    headless: opts.headed ? false : config.auth.headless,
  });
  const writesGate = new WritesGate({
    configEnabled: config.writes.enabled,
    cliFlag: opts.enableWritesFlag,
    configDryRun: config.writes.dry_run,
  });

  return {
    tokens,
    browser,
    bigQueryRepo: new RestBigQueryRepository(api),
    reportRepo: new LookerStudioUiReportRepository({
      browser,
      stepTimeoutMs: config.ui.step_timeout_ms,
      screenshotsDir: Paths.screenshotsDir(),
      logger,
    }),
    defaultProject: config.project_id,
    queryLimits: {
      location: config.location,
      maxRows: config.query.max_rows,
      maxBytesBilled: config.query.max_bytes_billed,
    },
    writesGate,
    writesEnabled: writesGate.allowsWrites,
    auditLogger: new AuditLogger({ logger, filePath: Paths.auditLog() }),
    dispose: () => browser.close(),
  };
}
