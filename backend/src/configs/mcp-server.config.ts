import config from 'config';

/**
 * Configuration interface for MCP server settings.
 *
 * @property enabled - Whether the MCP endpoint is active
 * @property endpoint - The URL path for the MCP endpoint
 * @property stateful - Whether to keep MCP sessions in memory (requires session affinity across replicas)
 * @property sessionIdleTimeout - Milliseconds of inactivity after which a stateful session is closed
 * @property maxSessions - Maximum number of concurrent stateful sessions held by one process
 * @property resourceUrl - Public URL of the MCP endpoint. It is the OAuth protected resource identifier,
 *   so it must equal the identifier of the Auth0 API that MCP tokens are issued for
 * @property scopes - Scopes advertised in the protected resource metadata
 * @property claudeClientId - Client id of the public Auth0 application Claude's custom connectors sign in with
 *   (the user pastes it in the connector's advanced settings); empty when none is registered
 */
export type McpServerConfig = {
  enabled: boolean;
  endpoint: string;
  stateful: boolean;
  sessionIdleTimeout: number;
  maxSessions: number;
  resourceUrl: string;
  scopes: string[];
  claudeClientId: string;
};

/**
 * Default idle window before a stateful MCP session is evicted.
 *
 * Sessions are only released when a client sends `DELETE /mcp`; a client that
 * disappears would otherwise leak its transport for the life of the pod.
 */
const DEFAULT_SESSION_IDLE_TIMEOUT_IN_MS = 300000;

/** Default ceiling on concurrent stateful sessions per process. */
const DEFAULT_MAX_SESSIONS = 100;

/** Default public URL of the MCP endpoint, for local runs. */
const DEFAULT_RESOURCE_URL = 'http://localhost:3002/mcp';

/** Default scopes advertised for the MCP resource. */
const DEFAULT_SCOPES: string[] = ['mcp:use'];

/** Configuration key used to look up MCP server settings in node-config. */
const CONFIG_KEY = 'McpServer';

/**
 * Resolved MCP server configuration.
 *
 * Reads from the `McpServer` key in node-config, falling back to
 * `enabled: true` and `endpoint: '/mcp'`.
 */
export const mcpServerConfig: McpServerConfig = {
  enabled: config.has(`${CONFIG_KEY}.enabled`) ? config.get(`${CONFIG_KEY}.enabled`) : true,
  endpoint: config.has(`${CONFIG_KEY}.endpoint`) ? config.get(`${CONFIG_KEY}.endpoint`) : '/mcp',
  stateful: config.has(`${CONFIG_KEY}.stateful`) ? config.get(`${CONFIG_KEY}.stateful`) : false,
  sessionIdleTimeout: config.has(`${CONFIG_KEY}.sessionIdleTimeout`)
    ? config.get(`${CONFIG_KEY}.sessionIdleTimeout`)
    : DEFAULT_SESSION_IDLE_TIMEOUT_IN_MS,
  maxSessions: config.has(`${CONFIG_KEY}.maxSessions`) ? config.get(`${CONFIG_KEY}.maxSessions`) : DEFAULT_MAX_SESSIONS,
  resourceUrl: config.has(`${CONFIG_KEY}.resourceUrl`) ? config.get(`${CONFIG_KEY}.resourceUrl`) : DEFAULT_RESOURCE_URL,
  scopes: config.has(`${CONFIG_KEY}.scopes`) ? config.get(`${CONFIG_KEY}.scopes`) : DEFAULT_SCOPES,
  claudeClientId: config.has(`${CONFIG_KEY}.claudeClientId`) ? config.get(`${CONFIG_KEY}.claudeClientId`) : '',
};
