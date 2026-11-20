import { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { APP_NAME, APP_VERSION } from '@constants';
import { registerToolControllers } from '@src/mcp/tools';
import { McpContext } from '@src/types';

/**
 * Instructions sent to MCP clients at initialization, to orient the model.
 *
 * Each phase extends them with what its tools let a model do, in the order a campaign is built.
 */
export const MCP_INSTRUCTIONS: string = [
  'Omnipotent runs advertising campaigns across media buying platforms on six levers: search, dooh,',
  'audio, social, ctv_tvs and dac (display and video on the web and in apps), from one interface.',
  'Data is organized as Seat (client company) > Organization (workspace) > Advertiser (brand).',
  'Start with get-me: it lists the Organizations the user can work in and their role in each, which',
  'gives the organizationId the other tools take; ask the user which one to use when there are several.',
  'A campaign hangs from an advertiser: Campaign > Lever (one channel) > AdGroup > TargetingGroup > Line.',
  'The campaign carries the budget, in integer cents, and the window; below, null inherits — a budget',
  'is divided equally between siblings, explicit amounts being served first. A read gives both what a',
  'node carries and what it may actually spend, so never add budgets up yourself.',
  'A lever chooses the platforms and their shares; what each lever accepts is its profile, which',
  'refuses at once rather than at launch: a budget on a Search line, a capping on Search, a platform',
  'the channel does not serve.',
  'Every node carrying an explicit budget has a daily curve, which always adds up to that budget: shape',
  'it with a preset, edit single days, lock the ones that must not move, and exclude the days that must',
  'not deliver. A day at 0 pauses the node that day. A node with an inherited budget has no curve of its',
  'own: it follows the shape of its parent at its scale. The pacing says what to spend today; the spend',
  'it compares against is 0 until the reporting phase exists, so it answers a plan.',
  'All the targeting lives on the TargetingGroup: an AdGroup and a Line carry none. get-targeting-dimensions',
  'says what can be targeted and the shape of each dimension, so never guess one; what a lever has nothing',
  'to do with is refused at once. Sites, apps, devices, points of interest, screens and negative keywords',
  'are reusable lists of the Organization that a targeting references by id. Only the search lever buys',
  'keywords, posted by the hundred on a TargetingGroup.',
  'The bytes of a creative are assets, a resource of their own in the library of an Advertiser: the same',
  'file uploaded twice is one asset. A creative is never the bytes — it has a format and a subtype, which',
  'get-creative-formats describes with the payload and the asset roles each couple needs — and its',
  'versions are immutable: a change is a new version, which delivers once activated, so delivery never',
  'stops while a platform revalidates.',
  'A campaign reaches a platform through a connected account: the Organization connects it, the client',
  'accepts the access, and each brand is linked to one account per platform and per currency with its',
  'identity there. A connected account is not usable until its access is active. Credentials are posted',
  'from the web interface or the HTTP API only: an API key or a token must never transit through a',
  'conversation, so never ask the user for one.',
  'A campaign is written permissively while it is a draft, so an incomplete campaign saves: the rigour is',
  'at publication. preview-campaign says what would be created on each platform and what is wrong, and',
  'launch-campaign refuses while it reports an error — so read the preview before proposing anything, and',
  'tell the user what it reports rather than guessing. A warning never blocks: it says something will be',
  'delivered short, which the user may accept.',
  'Once launched, a campaign is kept in step with its platforms on its own: every change is applied in',
  'the background, and nothing is sent when nothing changed. get-campaign-platform-status says what',
  'exists on each platform and where each unit stands — read it to answer « has my change gone live »,',
  'and read the code of a unit in error rather than retrying blindly. sync-campaign is only for when',
  'something was changed by hand on a platform; retry-platform-unit is for a failure that was fixed.',
  'Org-scoped tools take an organizationId; ask the user which Organization to use when there are several.',
  'Roles: viewer reads, manager edits, admin also manages members.',
].join(' ');

/**
 * Creates and configures an MCP server instance with all registered tools.
 *
 * This factory is the MCP equivalent of `src/modules/index.ts` for HTTP
 * controllers. Each call returns a fresh `McpServer` bound to the caller of
 * the request (one per request in stateless mode, one per session in stateful mode).
 *
 * @param fastify - The Fastify instance providing decorated services
 * @param context - The authenticated caller and their default Organization
 * @returns A fully configured MCP server ready to be connected to a transport
 */
export function createMcpServer(fastify: FastifyInstance, context: McpContext): McpServer {
  const server: McpServer = new McpServer(
    {
      name: APP_NAME,
      version: APP_VERSION,
    },
    { instructions: MCP_INSTRUCTIONS }
  );

  registerToolControllers(server, fastify, context);

  return server;
}
