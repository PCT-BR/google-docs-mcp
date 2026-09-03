export const GOOGLE_TOOL_GROUPS = [
  'docs',
  'drive',
  'sheets',
  'utils',
  'gmail',
  'calendar',
  'script',
] as const;

export type GoogleToolGroup = (typeof GOOGLE_TOOL_GROUPS)[number];

const TOOL_GROUP_SET = new Set<string>(GOOGLE_TOOL_GROUPS);

export const TOOL_GROUP_SCOPES: Record<GoogleToolGroup, readonly string[]> = {
  docs: ['https://www.googleapis.com/auth/documents'],
  drive: ['https://www.googleapis.com/auth/drive'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  utils: [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
  ],
  gmail: ['https://www.googleapis.com/auth/gmail.modify'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
  script: [
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.projects',
  ],
};

export function getScopesForToolGroups(enabledGroups: readonly GoogleToolGroup[]) {
  return [...new Set(enabledGroups.flatMap((group) => TOOL_GROUP_SCOPES[group]))];
}

export function parseEnabledToolGroups(raw: string | undefined = process.env.MCP_TOOL_GROUPS) {
  if (!raw?.trim()) return [...GOOGLE_TOOL_GROUPS];

  const requested = raw
    .split(',')
    .map((group) => group.trim().toLowerCase())
    .filter(Boolean);

  if (requested.length === 0 || requested.includes('all')) {
    return [...GOOGLE_TOOL_GROUPS];
  }

  const unknown = requested.filter((group) => !TOOL_GROUP_SET.has(group));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown MCP_TOOL_GROUPS value(s): ${unknown.join(', ')}. Valid groups: ${GOOGLE_TOOL_GROUPS.join(', ')}`
    );
  }

  const selected = new Set(requested);
  return GOOGLE_TOOL_GROUPS.filter((group) => selected.has(group));
}
