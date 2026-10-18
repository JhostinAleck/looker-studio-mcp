import type { AccessTokenProvider } from '@/contexts/authentication/domain/AccessTokenProvider.js';
import type { BrowserSession } from '@/contexts/authentication/domain/BrowserSession.js';
import { errorMessage, text, type ToolResult } from '@/mcp/tool-helpers.js';

export interface CheckAuthDeps {
  tokens: AccessTokenProvider;
  browser: BrowserSession;
  defaultProject: string | undefined;
  writesEnabled: boolean;
}

export async function handleCheckAuth(deps: CheckAuthDeps): Promise<ToolResult> {
  const lines: string[] = [];
  try {
    await deps.tokens.getAccessToken();
    const who = await deps.tokens.describeIdentity();
    lines.push(`✔ BigQuery: credentials OK${who ? ` (${who})` : ''}`);
  } catch (err) {
    lines.push(`✘ BigQuery: ${errorMessage(err)}`);
  }
  try {
    lines.push(
      (await deps.browser.isSignedIn())
        ? '✔ Looker Studio: browser profile signed in'
        : '✘ Looker Studio: not signed in. Run `looker-studio-mcp login`.',
    );
  } catch (err) {
    lines.push(`✘ Looker Studio: ${errorMessage(err)}`);
  }
  lines.push(
    deps.defaultProject
      ? `Default project: \`${deps.defaultProject}\``
      : 'No default project in the config.',
  );
  lines.push(deps.writesEnabled ? 'Writes: enabled' : 'Writes: disabled (read-only tools only)');
  return text(lines.join('\n'));
}
