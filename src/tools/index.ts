// src/tools/index.ts
import type { FastMCP } from 'fastmcp';
import { registerDocsTools } from './docs/index.js';
import { registerDriveTools } from './drive/index.js';
import { registerSheetsTools } from './sheets/index.js';
import { registerUtilsTools } from './utils/index.js';
import { registerGmailTools } from './gmail/index.js';
import { registerCalendarTools } from './calendar/index.js';
import { registerScriptTools } from './script/index.js';
import {
  GOOGLE_TOOL_GROUPS,
  parseEnabledToolGroups,
  type GoogleToolGroup,
} from '../googleScopes.js';

export const TOOL_GROUPS = GOOGLE_TOOL_GROUPS;

export type ToolGroup = GoogleToolGroup;
export { parseEnabledToolGroups };

/**
 * Registers all tools with the FastMCP server.
 */
export function registerAllTools(
  server: FastMCP,
  enabledGroups: readonly ToolGroup[] = parseEnabledToolGroups()
) {
  for (const group of enabledGroups) {
    switch (group) {
      case 'docs':
        registerDocsTools(server);
        break;
      case 'drive':
        registerDriveTools(server);
        break;
      case 'sheets':
        registerSheetsTools(server);
        break;
      case 'utils':
        registerUtilsTools(server);
        break;
      case 'gmail':
        registerGmailTools(server);
        break;
      case 'calendar':
        registerCalendarTools(server);
        break;
      case 'script':
        registerScriptTools(server);
        break;
    }
  }
}
