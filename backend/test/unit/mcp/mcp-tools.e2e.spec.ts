import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { createMcpServer, MCP_INSTRUCTIONS } from '@src/mcp';
import { mcpToolRateLimiter } from '@src/mcp/tool-rate-limit';
import {
  Advertiser,
  BulkResult,
  DeletionResult,
  Label,
  LabelledResource,
  McpContext,
  Paginated,
  StatusResult,
  statusResultSchema,
} from '@src/types';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { EXPECTED_TOOLS } from '@test/unit/mocks/mcp-tools.fixtures';
import { httpError } from '@utils';

/** Result of `client.callTool(...)`. */
type ToolCallResult = Awaited<ReturnType<Client['callTool']>>;

/**
 * Services the MCP tools reach through the Fastify instance.
 *
 * Each phase adds the services of its tools here.
 */
type ServiceName =
  | 'statusService'
  | 'labelService'
  | 'advertiserService'
  | 'campaignService'
  | 'leverService'
  | 'adGroupService'
  | 'targetingGroupService'
  | 'lineService'
  | 'budgetCurveService';

/** A fake Fastify instance: every service method is a jest mock. */
type FakeServices = Record<ServiceName, Record<string, jest.Mock>>;

/** A client connected to a real MCP server through an in-memory transport. */
type Connection = { client: Client; close: () => Promise<void> };

/** What `get-status` answers. */
const STATUS: StatusResult = { app_name: 'omnipotent', app_version: '1.0.0', timestamp: NOW.getTime() };

/** Id of the Label the tools work on. */
const LABEL_ID = 'e0000000-0000-4000-8000-000000000001';

/** What the Label tools answer. */
const LABEL: Label = {
  id: LABEL_ID,
  organizationId: IDS.organization,
  name: 'Printemps',
  color: '#1f6feb',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  deletedAt: null,
};

/** What the Advertiser tools answer. */
const ADVERTISER: Advertiser = {
  id: IDS.advertiser,
  organizationId: IDS.organization,
  name: 'Herbéa',
  websiteUrl: 'https://herbea.test',
  labels: [{ id: LABEL_ID, name: 'Printemps', color: '#1f6feb' }],
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  deletedAt: null,
};

/** What a deletion tool answers. */
const DELETED: DeletionResult = { id: IDS.advertiser, deletedAt: NOW.toISOString() };

/** What a restoration tool answers. */
const RESTORED: DeletionResult = { id: IDS.advertiser, deletedAt: null };

/** What a bulk of deletions or restorations answers. */
const BULK_DELETIONS: BulkResult<DeletionResult> = { items: [DELETED], failed: [] };

/** What `list-label-resources` answers. */
const RESOURCE_PAGE: Paginated<LabelledResource> = {
  items: [{ resourceType: 'advertiser', resourceId: IDS.advertiser, name: 'Herbéa' }],
  total: 1,
  page: 1,
  limit: 50,
};

/** The query a list of Labels receives once the defaults of its schema apply. */
const LABEL_QUERY = { page: 1, limit: 50, sortBy: 'name', sortOrder: 'asc', includeDeleted: false };

/** The query a list of Advertisers receives once the defaults of its schema apply. */
const ADVERTISER_QUERY = { ...LABEL_QUERY, labelMode: 'any' };

/** The budget block every level of the tree answers. */
const BUDGET = {
  explicitCents: null,
  effectiveCents: 100_000,
  source: 'inherited',
  volume: null,
  perPlatform: [{ platform: 'hawk', shareBasisPoints: 10_000, cents: 100_000 }],
};

/** What every node of the tree carries, whatever its level. */
const NODE = {
  id: 'f9000000-0000-4000-8000-000000000001',
  organizationId: IDS.organization,
  budget: BUDGET,
  capping: null,
  labels: [],
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  deletedAt: null,
};

/** The id of a parent, and the id of a node: the services are mocked, so any uuid will do. */
const PARENT_ID: string = IDS.advertiser;
const NODE_ID: string = NODE.id;

/**
 * One level of the campaign tree, and what its tools send and answer.
 *
 * The five levels serve the same CRUD, so their tools are generated from this table rather than
 * written out one by one: fifty-one rows by hand would be fifty-one chances to mistype an argument,
 * and the generated ones are checked against the real output schemas by the protocol itself.
 *
 * @property singular - The resource in a tool name (`campaign` in `get-campaign`)
 * @property plural - The resource in a plural tool name (`campaigns` in `list-campaigns`)
 * @property service - The service its tools reach
 * @property parentArg - The argument naming its parent, on the tools that take one
 * @property ownArg - The argument naming the node itself
 * @property createBody - A body its creation accepts
 * @property updateBody - A body its update accepts
 * @property resource - The node as the API answers it, which its output schema must accept
 * @property bulk - Whether it serves the bulk tools
 */
type TreeLevelCase = {
  singular: string;
  plural: string;
  service: ServiceName;
  parentArg: string;
  ownArg: string;
  createBody: Record<string, unknown>;
  updateBody: Record<string, unknown>;
  resource: Record<string, unknown>;
  bulk: boolean;
};

/** The five levels, in the order the server registers their tools. */
const TREE_LEVELS: TreeLevelCase[] = [
  {
    singular: 'campaign',
    plural: 'campaigns',
    service: 'campaignService',
    parentArg: 'advertiserId',
    ownArg: 'campaignId',
    createBody: {
      name: 'Herbéa — Automne',
      currency: 'EUR',
      startsOn: '2026-11-05',
      endsOn: '2026-11-20',
      budgetCents: 100_000,
    },
    updateBody: { name: 'Herbéa — Hiver' },
    resource: {
      ...NODE,
      advertiserId: PARENT_ID,
      name: 'Herbéa — Automne',
      status: 'draft',
      currency: 'EUR',
      timezone: null,
      startsOn: '2026-11-05',
      endsOn: '2026-11-20',
      capping: [],
      insertionOrderNumber: null,
      budget: { ...BUDGET, source: 'explicit', explicitCents: 100_000, perPlatform: [] },
    },
    bulk: true,
  },
  {
    singular: 'lever',
    plural: 'levers',
    service: 'leverService',
    parentArg: 'campaignId',
    ownArg: 'leverId',
    createBody: { lever: 'dac', platformShares: [{ platform: 'hawk', shareBasisPoints: 10_000 }] },
    updateBody: { productsMode: false },
    resource: {
      ...NODE,
      campaignId: PARENT_ID,
      lever: 'dac',
      status: 'active',
      productsMode: false,
      platformShares: [{ platform: 'hawk', shareBasisPoints: 10_000 }],
      startsOn: null,
      endsOn: null,
    },
    bulk: false,
  },
  {
    singular: 'ad-group',
    plural: 'ad-groups',
    service: 'adGroupService',
    parentArg: 'leverId',
    ownArg: 'adGroupId',
    createBody: { name: 'Prospection' },
    updateBody: { name: 'Retargeting' },
    resource: {
      ...NODE,
      campaignId: 'f1000000-0000-4000-8000-000000000001',
      leverId: PARENT_ID,
      lever: 'dac',
      name: 'Prospection',
      status: 'active',
      objective: 'awareness',
      bidStrategy: 'fixed_cpm',
      bidAmountCents: 450,
      platformShares: null,
      startsOn: null,
      endsOn: null,
    },
    bulk: true,
  },
  {
    singular: 'targeting-group',
    plural: 'targeting-groups',
    service: 'targetingGroupService',
    parentArg: 'adGroupId',
    ownArg: 'targetingGroupId',
    createBody: { name: 'Île-de-France' },
    updateBody: { bidAmountCents: 300 },
    resource: {
      ...NODE,
      campaignId: 'f1000000-0000-4000-8000-000000000001',
      adGroupId: PARENT_ID,
      lever: 'dac',
      name: 'Île-de-France',
      status: 'active',
      bidAmountCents: null,
    },
    bulk: true,
  },
  {
    singular: 'line',
    plural: 'lines',
    service: 'lineService',
    parentArg: 'targetingGroupId',
    ownArg: 'lineId',
    createBody: { name: 'Bannière 300x250' },
    updateBody: { landingPageUrl: 'https://herbea.test/automne' },
    resource: {
      ...NODE,
      campaignId: 'f1000000-0000-4000-8000-000000000001',
      targetingGroupId: PARENT_ID,
      lever: 'dac',
      name: 'Bannière 300x250',
      status: 'active',
      landingPageUrl: null,
      startsOn: null,
      endsOn: null,
    },
    bulk: true,
  },
];

/** What the curve tools answer, whatever the level: a week at 100 € a day. */
const CURVE = {
  level: 'campaign',
  nodeId: NODE_ID,
  source: 'own',
  totalCents: 70_000,
  days: [{ day: '2027-01-01', cents: 10_000, locked: false, weekend: false }],
};

/** What the pacing tools answer. */
const PACING = {
  plannedCents: 70_000,
  plannedToDateCents: 50_000,
  remainingCents: 70_000,
  todayCents: 35_000,
  budgetReached: false,
  status: 'underspending',
};

/**
 * The tool calls one level serves on its curve and on its pacing (`backend/docs/phase-4.md` § 6).
 *
 * The level the service receives is the singular of the URLs with an underscore, as the
 * `budget_days` rows spell it.
 *
 * @param level - The level
 * @returns One case per curve tool it serves
 */
function curveCases(level: TreeLevelCase): ToolCase[] {
  const { singular, ownArg } = level;
  const own: Record<string, string> = { [ownArg]: NODE_ID };
  const name: string = singular.replace('-', '_');
  const curve = { ...CURVE, level: name };
  const days = [{ day: '2027-01-01', cents: 10_000 }];
  return [
    {
      tool: `get-${singular}-budget-days`,
      args: own,
      service: 'budgetCurveService',
      method: 'get',
      answer: curve,
      expected: [name, NODE_ID],
    },
    {
      tool: `update-${singular}-budget-days`,
      args: { ...own, days },
      service: 'budgetCurveService',
      method: 'update',
      answer: curve,
      expected: [name, NODE_ID, { days }],
    },
    {
      tool: `apply-${singular}-budget-preset`,
      args: { ...own, preset: 'weekend_boost', factor: 2 },
      service: 'budgetCurveService',
      method: 'applyPreset',
      answer: curve,
      expected: [name, NODE_ID, { preset: 'weekend_boost', factor: 2 }],
    },
    {
      tool: `reset-${singular}-budget-days`,
      args: own,
      service: 'budgetCurveService',
      method: 'reset',
      answer: curve,
      expected: [name, NODE_ID],
    },
    {
      tool: `get-${singular}-pacing`,
      args: own,
      service: 'budgetCurveService',
      method: 'pacing',
      answer: PACING,
      expected: [name, NODE_ID],
    },
  ];
}

/**
 * The tool calls of one level of the tree.
 *
 * @param level - The level
 * @returns One case per tool it serves
 */
function treeLevelCases(level: TreeLevelCase): ToolCase[] {
  const { singular, plural, service, parentArg, ownArg, resource } = level;
  const parent: Record<string, string> = { [parentArg]: PARENT_ID };
  const own: Record<string, string> = { [ownArg]: NODE_ID };
  const deletion = { id: NODE_ID, deletedAt: NOW.toISOString() };
  const page = { items: [resource], total: 1, page: 1, limit: 50 };
  const cases: ToolCase[] = [
    {
      tool: `list-${plural}`,
      args: parent,
      service,
      method: 'list',
      answer: page,
      expected: [PARENT_ID, expect.objectContaining({ page: 1, limit: 50 })],
    },
    { tool: `get-${singular}`, args: own, service, method: 'get', answer: resource, expected: [NODE_ID] },
    {
      tool: `create-${singular}`,
      args: { ...parent, ...level.createBody },
      service,
      method: 'create',
      answer: resource,
      expected: [PARENT_ID, expect.objectContaining(level.createBody)],
    },
    {
      tool: `update-${singular}`,
      args: { ...own, ...level.updateBody },
      service,
      method: 'update',
      answer: resource,
      expected: [NODE_ID, expect.objectContaining(level.updateBody)],
    },
    { tool: `delete-${singular}`, args: own, service, method: 'delete', answer: deletion, expected: [NODE_ID] },
    {
      tool: `restore-${singular}`,
      args: own,
      service,
      method: 'restore',
      answer: { id: NODE_ID, deletedAt: null },
      expected: [NODE_ID],
    },
    {
      tool: `set-${singular}-labels`,
      args: { ...own, labelIds: [] },
      service,
      method: 'setLabels',
      answer: resource,
      expected: [NODE_ID, { labelIds: [] }],
    },
  ];
  if (!level.bulk) return cases;
  return [
    ...cases,
    {
      tool: `bulk-create-${plural}`,
      args: { ...parent, items: [level.createBody] },
      service,
      method: 'bulkCreate',
      answer: { items: [resource], failed: [] },
      expected: [PARENT_ID, expect.objectContaining({ mode: 'atomic' })],
    },
    {
      tool: `bulk-update-${plural}`,
      args: { items: [{ id: NODE_ID, ...level.updateBody }] },
      service,
      method: 'bulkUpdate',
      answer: { items: [resource], failed: [] },
      expected: [expect.objectContaining({ mode: 'atomic' })],
    },
    {
      tool: `bulk-delete-${plural}`,
      args: { ids: [NODE_ID] },
      service,
      method: 'bulkDelete',
      answer: { items: [deletion], failed: [] },
      expected: [{ mode: 'atomic', ids: [NODE_ID] }],
    },
    {
      tool: `bulk-restore-${plural}`,
      args: { ids: [NODE_ID] },
      service,
      method: 'bulkRestore',
      answer: { items: [{ id: NODE_ID, deletedAt: null }], failed: [] },
      expected: [{ mode: 'atomic', ids: [NODE_ID] }],
    },
  ];
}

/**
 * One tool call: what an assistant sends, and what the service behind it must receive.
 *
 * @property tool - Name of the tool
 * @property args - Arguments sent, without `organizationId`: the connection's header carries it
 * @property service - The service the tool reaches
 * @property method - The method it calls
 * @property answer - What that method resolves with
 * @property expected - The arguments after the caller and the Organization
 */
type ToolCase = {
  tool: string;
  args: Record<string, unknown>;
  service: ServiceName;
  method: string;
  answer: object;
  expected: unknown[];
};

/** Every org-scoped tool of the phase, with the call it must make. */
const TOOL_CASES: ToolCase[] = [
  {
    tool: 'list-labels',
    args: {},
    service: 'labelService',
    method: 'list',
    answer: { items: [LABEL], total: 1, page: 1, limit: 50 },
    expected: [LABEL_QUERY],
  },
  {
    tool: 'get-label',
    args: { labelId: LABEL_ID },
    service: 'labelService',
    method: 'get',
    answer: LABEL,
    expected: [LABEL_ID],
  },
  {
    tool: 'create-label',
    args: { name: 'Printemps', color: '#1f6feb' },
    service: 'labelService',
    method: 'create',
    answer: LABEL,
    expected: [{ name: 'Printemps', color: '#1f6feb' }],
  },
  {
    tool: 'update-label',
    args: { labelId: LABEL_ID, color: '#d29922' },
    service: 'labelService',
    method: 'update',
    answer: LABEL,
    expected: [LABEL_ID, { color: '#d29922' }],
  },
  {
    tool: 'delete-label',
    args: { labelId: LABEL_ID },
    service: 'labelService',
    method: 'delete',
    answer: DELETED,
    expected: [LABEL_ID],
  },
  {
    tool: 'restore-label',
    args: { labelId: LABEL_ID },
    service: 'labelService',
    method: 'restore',
    answer: RESTORED,
    expected: [LABEL_ID],
  },
  {
    tool: 'list-label-resources',
    args: { labelId: LABEL_ID },
    service: 'labelService',
    method: 'resources',
    answer: RESOURCE_PAGE,
    expected: [LABEL_ID, { page: 1, limit: 50 }],
  },
  {
    tool: 'bulk-create-labels',
    args: { items: [{ name: 'Printemps', color: '#1f6feb' }] },
    service: 'labelService',
    method: 'bulkCreate',
    answer: { items: [LABEL], failed: [] },
    expected: [{ mode: 'atomic', items: [{ name: 'Printemps', color: '#1f6feb' }] }],
  },
  {
    tool: 'bulk-update-labels',
    args: { items: [{ id: LABEL_ID, color: '#d29922' }] },
    service: 'labelService',
    method: 'bulkUpdate',
    answer: { items: [LABEL], failed: [] },
    expected: [{ mode: 'atomic', items: [{ id: LABEL_ID, color: '#d29922' }] }],
  },
  {
    tool: 'bulk-delete-labels',
    args: { ids: [LABEL_ID], mode: 'partial' },
    service: 'labelService',
    method: 'bulkDelete',
    answer: BULK_DELETIONS,
    expected: [{ mode: 'partial', ids: [LABEL_ID] }],
  },
  {
    tool: 'bulk-restore-labels',
    args: { ids: [LABEL_ID] },
    service: 'labelService',
    method: 'bulkRestore',
    answer: BULK_DELETIONS,
    expected: [{ mode: 'atomic', ids: [LABEL_ID] }],
  },
  {
    tool: 'list-advertisers',
    args: {},
    service: 'advertiserService',
    method: 'list',
    answer: { items: [ADVERTISER], total: 1, page: 1, limit: 50 },
    expected: [ADVERTISER_QUERY],
  },
  {
    tool: 'get-advertiser',
    args: { advertiserId: IDS.advertiser },
    service: 'advertiserService',
    method: 'get',
    answer: ADVERTISER,
    expected: [IDS.advertiser],
  },
  {
    tool: 'create-advertiser',
    args: { name: 'Herbéa', labelIds: [LABEL_ID] },
    service: 'advertiserService',
    method: 'create',
    answer: ADVERTISER,
    expected: [{ name: 'Herbéa', labelIds: [LABEL_ID] }],
  },
  {
    tool: 'update-advertiser',
    args: { advertiserId: IDS.advertiser, websiteUrl: null },
    service: 'advertiserService',
    method: 'update',
    answer: ADVERTISER,
    expected: [IDS.advertiser, { websiteUrl: null }],
  },
  {
    tool: 'delete-advertiser',
    args: { advertiserId: IDS.advertiser },
    service: 'advertiserService',
    method: 'delete',
    answer: DELETED,
    expected: [IDS.advertiser],
  },
  {
    tool: 'restore-advertiser',
    args: { advertiserId: IDS.advertiser },
    service: 'advertiserService',
    method: 'restore',
    answer: RESTORED,
    expected: [IDS.advertiser],
  },
  {
    tool: 'set-advertiser-labels',
    args: { advertiserId: IDS.advertiser, labelIds: [LABEL_ID] },
    service: 'advertiserService',
    method: 'setLabels',
    answer: ADVERTISER,
    expected: [IDS.advertiser, { labelIds: [LABEL_ID] }],
  },
  {
    tool: 'bulk-create-advertisers',
    args: { items: [{ name: 'Herbéa' }] },
    service: 'advertiserService',
    method: 'bulkCreate',
    answer: { items: [ADVERTISER], failed: [] },
    expected: [{ mode: 'atomic', items: [{ name: 'Herbéa' }] }],
  },
  {
    tool: 'bulk-update-advertisers',
    args: { items: [{ id: IDS.advertiser, name: 'Herbéa' }] },
    service: 'advertiserService',
    method: 'bulkUpdate',
    answer: { items: [ADVERTISER], failed: [] },
    expected: [{ mode: 'atomic', items: [{ id: IDS.advertiser, name: 'Herbéa' }] }],
  },
  {
    tool: 'bulk-delete-advertisers',
    args: { ids: [IDS.advertiser] },
    service: 'advertiserService',
    method: 'bulkDelete',
    answer: BULK_DELETIONS,
    expected: [{ mode: 'atomic', ids: [IDS.advertiser] }],
  },
  {
    tool: 'bulk-restore-advertisers',
    args: { ids: [IDS.advertiser] },
    service: 'advertiserService',
    method: 'bulkRestore',
    answer: BULK_DELETIONS,
    expected: [{ mode: 'atomic', ids: [IDS.advertiser] }],
  },
  ...TREE_LEVELS.flatMap(treeLevelCases),
  ...TREE_LEVELS.flatMap(curveCases),
];

/** The bulk tools, with the route whose limit they are counted on. */
const BULK_TOOL_ROUTES: [string, Record<string, unknown>, string][] = [
  ['bulk-create-labels', { items: [{ name: 'Printemps', color: '#1f6feb' }] }, 'POST /labels/bulk'],
  ['bulk-update-labels', { items: [{ id: LABEL_ID, color: '#d29922' }] }, 'PATCH /labels/bulk'],
  ['bulk-delete-labels', { ids: [LABEL_ID] }, 'DELETE /labels/bulk'],
  ['bulk-restore-labels', { ids: [LABEL_ID] }, 'POST /labels/bulk/restore'],
  ['bulk-create-advertisers', { items: [{ name: 'Herbéa' }] }, 'POST /advertisers/bulk'],
  ['bulk-update-advertisers', { items: [{ id: IDS.advertiser, name: 'H' }] }, 'PATCH /advertisers/bulk'],
  ['bulk-delete-advertisers', { ids: [IDS.advertiser] }, 'DELETE /advertisers/bulk'],
  ['bulk-restore-advertisers', { ids: [IDS.advertiser] }, 'POST /advertisers/bulk/restore'],
  ...TREE_LEVELS.filter((level: TreeLevelCase): boolean => level.bulk).flatMap(
    (level: TreeLevelCase): [string, Record<string, unknown>, string][] => [
      [
        `bulk-create-${level.plural}`,
        { [level.parentArg]: PARENT_ID, items: [level.createBody] },
        `POST /${parentUrlOf(level)}/:id/${level.plural}/bulk`,
      ],
      [`bulk-update-${level.plural}`, { items: [{ id: NODE_ID, ...level.updateBody }] }, `PATCH /${level.plural}/bulk`],
      [`bulk-delete-${level.plural}`, { ids: [NODE_ID] }, `DELETE /${level.plural}/bulk`],
      [`bulk-restore-${level.plural}`, { ids: [NODE_ID] }, `POST /${level.plural}/bulk/restore`],
    ]
  ),
];

/**
 * The URL of the parent a level hangs from, as the rate limits name it.
 *
 * @param level - The level
 * @returns The plural of its parent in a URL
 */
function parentUrlOf(level: TreeLevelCase): string {
  return {
    advertiserId: 'advertisers',
    campaignId: 'campaigns',
    leverId: 'levers',
    adGroupId: 'ad-groups',
    targetingGroupId: 'targeting-groups',
  }[level.parentArg] as string;
}

/**
 * Build the fake services the tools reach.
 *
 * @returns The fakes, with their answers set
 */
function fakeServices(): FakeServices {
  const crud = (): Record<string, jest.Mock> => ({
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    restore: jest.fn(),
    resources: jest.fn(),
    setLabels: jest.fn(),
    bulkCreate: jest.fn(),
    bulkUpdate: jest.fn(),
    bulkDelete: jest.fn(),
    bulkRestore: jest.fn(),
  });
  return {
    statusService: { getStatus: jest.fn().mockReturnValue(STATUS) },
    labelService: crud(),
    advertiserService: crud(),
    campaignService: crud(),
    leverService: crud(),
    adGroupService: crud(),
    targetingGroupService: crud(),
    lineService: crud(),
    budgetCurveService: {
      get: jest.fn(),
      update: jest.fn(),
      applyPreset: jest.fn(),
      reset: jest.fn(),
      pacing: jest.fn(),
    },
  };
}

/**
 * Connect a real MCP client to a real MCP server through an in-memory transport, so a tool call goes
 * through the protocol — argument validation, `structuredContent` against the advertised output
 * schema, and tool errors — exactly as an assistant's would.
 *
 * @param services - The fake services the tools reach
 * @param context - The caller of the MCP connection
 * @returns The connected client and a function closing both ends
 */
async function connect(services: FakeServices, context: McpContext): Promise<Connection> {
  const server: McpServer = createMcpServer(services as unknown as FastifyInstance, context);
  const [clientTransport, serverTransport]: [InMemoryTransport, InMemoryTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client: Client = new Client({ name: 'e2e-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  await client.listTools();

  return {
    client,
    close: async (): Promise<void> => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * The text of the single content block of a tool result.
 *
 * @param result - A tool result
 * @returns Its text
 */
function textOf(result: ToolCallResult): string {
  return (result.content as { type: string; text: string }[])[0].text;
}

describe('Unit::Mcp::McpToolsE2E', () => {
  const context: McpContext = { auth: JANE, organizationId: IDS.organization };
  let services: FakeServices;
  let connection: Connection;

  beforeEach(async (): Promise<void> => {
    services = fakeServices();
    connection = await connect(services, context);
  });

  afterEach(async (): Promise<void> => {
    await connection.close();
    jest.restoreAllMocks();
  });

  describe('fixtures', () => {
    it('should answer what the schema of the resource describes', (): void => {
      expect(statusResultSchema.safeParse(STATUS).success).toBe(true);
    });
  });

  describe('initialize', () => {
    it('should hand the client the instructions of the server', (): void => {
      expect(connection.client.getInstructions()).toBe(MCP_INSTRUCTIONS);
    });
  });

  describe('tools/list', () => {
    it('should list every tool exactly once', async (): Promise<void> => {
      const { tools }: { tools: Tool[] } = await connection.client.listTools();

      expect(tools.map((tool: Tool): string => tool.name)).toEqual(EXPECTED_TOOLS);
    });

    it('should give every tool a title, a description and an output JSON schema', async (): Promise<void> => {
      const { tools }: { tools: Tool[] } = await connection.client.listTools();

      for (const tool of tools) {
        expect(tool).toEqual(
          expect.objectContaining({
            title: expect.any(String),
            description: expect.any(String),
            outputSchema: expect.objectContaining({ type: 'object', properties: expect.any(Object) }),
          })
        );
      }
    });

    it('should cover every org-scoped tool of the phase with a call', (): void => {
      const covered: string[] = ['get-status', ...TOOL_CASES.map((toolCase: ToolCase): string => toolCase.tool)];

      expect(covered.sort()).toEqual([...EXPECTED_TOOLS].sort());
    });
  });

  describe('tools/call', () => {
    it('should reach the service and answer its payload twice: structured and as JSON text', async (): Promise<void> => {
      const result: ToolCallResult = await connection.client.callTool({ name: 'get-status', arguments: {} });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(STATUS);
      expect(JSON.parse(textOf(result))).toEqual(STATUS);
      expect(services.statusService.getStatus).toHaveBeenCalledTimes(1);
    });

    it.each(TOOL_CASES)(
      'should call the service of $tool with the caller, the Organization and what the model sent',
      async ({ tool, args, service, method, answer, expected }: ToolCase): Promise<void> => {
        services[service][method].mockResolvedValue(answer);

        const result: ToolCallResult = await connection.client.callTool({ name: tool, arguments: args });

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual(answer);
        expect(services[service][method]).toHaveBeenCalledWith(JANE, IDS.organization, ...expected);
      }
    );

    it('should prefer the Organization the model names to the one of the connection', async (): Promise<void> => {
      services.labelService.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });

      await connection.client.callTool({
        name: 'list-labels',
        arguments: { organizationId: IDS.otherOrganization },
      });

      expect(services.labelService.list).toHaveBeenCalledWith(JANE, IDS.otherOrganization, LABEL_QUERY);
    });

    it('should ask for an Organization when neither the model nor the connection names one', async (): Promise<void> => {
      const bare: Connection = await connect(services, { auth: JANE });

      const result: ToolCallResult = await bare.client.callTool({ name: 'list-labels', arguments: {} });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('organizationId is required');
      expect(services.labelService.list).not.toHaveBeenCalled();

      await bare.close();
    });

    it('should refuse an argument the tool does not accept, before any service is called', async (): Promise<void> => {
      const result: ToolCallResult = await connection.client.callTool({
        name: 'get-advertiser',
        arguments: { advertiserId: 'not-a-uuid' },
      });

      expect(result.isError).toBe(true);
      expect(services.advertiserService.get).not.toHaveBeenCalled();
    });

    it('should refuse an argument the tool does not declare, rather than ignoring it', async (): Promise<void> => {
      const result: ToolCallResult = await connection.client.callTool({
        name: 'get-advertiser',
        arguments: { advertiserId: IDS.advertiser, advertiser: 'Herbéa' },
      });

      expect(result.isError).toBe(true);
      expect(services.advertiserService.get).not.toHaveBeenCalled();
    });

    it('should hand the model the business error of the service, as it is', async (): Promise<void> => {
      services.advertiserService.restore.mockRejectedValue(
        httpError(409, 'This advertiser is not deleted', { code: 'advertiser_not_deleted' })
      );

      const result: ToolCallResult = await connection.client.callTool({
        name: 'restore-advertiser',
        arguments: { advertiserId: IDS.advertiser },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('This advertiser is not deleted');
    });

    it.each(BULK_TOOL_ROUTES)(
      'should count %s against the limit of the route it mirrors',
      async (tool: string, args: Record<string, unknown>, route: string): Promise<void> => {
        const consume: jest.SpyInstance = jest.spyOn(mcpToolRateLimiter, 'consume').mockImplementation((): void => {});
        for (const service of [services.labelService, services.advertiserService]) {
          for (const method of ['bulkCreate', 'bulkUpdate', 'bulkDelete', 'bulkRestore']) {
            service[method].mockResolvedValue({ items: [], failed: [] });
          }
        }

        await connection.client.callTool({ name: tool, arguments: args });

        expect(consume).toHaveBeenCalledWith(expect.objectContaining({ auth: JANE }), route);
      }
    );

    it('should refuse a tool it does not know', async (): Promise<void> => {
      const result: ToolCallResult = await connection.client.callTool({ name: 'get-campaign', arguments: {} });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('get-campaign');
    });
  });
});
