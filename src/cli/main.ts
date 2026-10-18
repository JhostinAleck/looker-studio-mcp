#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  version: string;
};

function fail(err: unknown): never {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

const program = new Command();
program
  .name('looker-studio-mcp')
  .description('MCP server for Looker Studio (Data Studio) and BigQuery')
  .version(pkg.version);

program
  .command('serve', { isDefault: true })
  .description('Start the MCP server (stdio transport)')
  .option('--config <path>', 'Path to config YAML')
  .option('--project <id>', 'Google Cloud project for BigQuery')
  .option('--enable-writes', 'Enable write operations (requires writes.enabled: true in config)')
  .option('--headed', 'Show the Chrome window while editing reports')
  .action(async (opts) => {
    const { runServe } = await import('./commands/serve.js');
    await runServe(opts).catch((err: unknown) => fail(`Failed to start server: ${String(err)}`));
  });

program
  .command('login')
  .description('Sign in to Google once in the MCP browser profile (needed for report tools)')
  .option('--config <path>', 'Path to config YAML')
  .option('--chrome-path <path>', 'Google Chrome binary (auto-detected)')
  .action(async (opts) => {
    const { runLogin } = await import('./commands/login.js');
    await runLogin(opts).catch(fail);
  });

program
  .command('auth')
  .description('Check Google API credentials and the browser sign-in')
  .option('--config <path>', 'Path to config YAML')
  .option('--test', 'Run the checks (default)')
  .action(async (opts) => {
    const { runAuthTest } = await import('./commands/auth.js');
    await runAuthTest(opts).catch(fail);
  });

program
  .command('init')
  .description('Write ~/.looker-studio-mcp/config.yaml without prompts')
  .requiredOption('--project <id>', 'Google Cloud project for BigQuery')
  .option('--location <loc>', 'BigQuery location', 'US')
  .option('--credentials-file <path>', 'Service account or authorized_user JSON (default: ADC)')
  .option('--enable-writes', 'Set writes.enabled: true')
  .option('--config <path>', 'Config file path')
  .option('--force', 'Overwrite an existing config')
  .action(async (opts) => {
    const { runInit } = await import('./commands/init.js');
    await runInit(opts).catch(fail);
  });

await program.parseAsync(process.argv);
