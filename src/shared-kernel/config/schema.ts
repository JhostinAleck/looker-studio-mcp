import { z } from 'zod';

// Where the Google API access token comes from.
// - adc: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC)
// - file: a service account or authorized_user JSON at `credentials_file`
export const GoogleCredentialsKindSchema = z.enum(['adc', 'file']);

const AuthConfigSchema = z
  .object({
    credentials: GoogleCredentialsKindSchema.default('adc'),
    credentials_file: z.string().optional(),
    // Persistent Chrome profile signed in to Looker Studio (created by `looker-studio-mcp login`).
    browser_profile_dir: z.string().optional(),
    // Real Chrome passes Google's sign-in checks; bundled Chromium often does not.
    browser_channel: z.enum(['chrome', 'chromium', 'msedge']).default('chrome'),
    headless: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.credentials === 'file' && !data.credentials_file) {
      ctx.addIssue({
        code: 'custom',
        message: 'auth.credentials_file is required when auth.credentials=file',
      });
    }
  });

export const ConfigSchema = z.object({
  // Google Cloud project used for BigQuery jobs and as the default data source project.
  project_id: z.string().optional(),
  // BigQuery location for new datasets and query jobs (e.g. US, EU, us-east1).
  location: z.string().default('US'),
  auth: AuthConfigSchema.default({ credentials: 'adc', browser_channel: 'chrome', headless: true }),
  writes: z
    .object({
      enabled: z.boolean().default(false),
      dry_run: z.boolean().default(false),
    })
    .default({ enabled: false, dry_run: false }),
  query: z
    .object({
      // Hard cap on rows returned to the assistant per query.
      max_rows: z.number().int().positive().max(10_000).default(500),
      // Refuses queries that would scan more than this (protects the free tier).
      max_bytes_billed: z.number().int().positive().default(1_000_000_000),
    })
    .default({ max_rows: 500, max_bytes_billed: 1_000_000_000 }),
  ui: z
    .object({
      // Timeout for each Looker Studio editor step.
      step_timeout_ms: z.number().int().positive().default(30_000),
    })
    .default({ step_timeout_ms: 30_000 }),
  logging: z
    .object({
      level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    })
    .default({ level: 'info' }),
});

export type Config = z.infer<typeof ConfigSchema>;
