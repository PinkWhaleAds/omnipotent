/**
 * Every tool the MCP server registers, in the order it registers them.
 *
 * One list for the two specs that read it — the factory's (`mcp-server.factory.spec.ts`) and the
 * end-to-end one (`mcp-tools.e2e.spec.ts`) — so a tool registered twice, renamed, or added without
 * a call exercising it fails them both. Each phase adds the tools of its resource here.
 */
export const EXPECTED_TOOLS: string[] = [
  'get-status',
  'list-labels',
  'get-label',
  'create-label',
  'update-label',
  'delete-label',
  'restore-label',
  'list-label-resources',
  'bulk-create-labels',
  'bulk-update-labels',
  'bulk-delete-labels',
  'bulk-restore-labels',
  'list-advertisers',
  'get-advertiser',
  'create-advertiser',
  'update-advertiser',
  'delete-advertiser',
  'restore-advertiser',
  'set-advertiser-labels',
  'bulk-create-advertisers',
  'bulk-update-advertisers',
  'bulk-delete-advertisers',
  'bulk-restore-advertisers',
];
