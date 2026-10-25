import config from 'config';

/**
 * Configuration interface for HTTP server settings.
 *
 * @property host - The hostname or IP address the server binds to
 * @property port - The port number the server listens on
 * @property corsOrigins - Origins of the web front ends allowed to call the API from a browser (CORS); none by
 *   default
 * @property trustProxyHops - Proxies in front of the server whose `X-Forwarded-For` entry is trusted, Fastify's
 *   `trustProxy` (0, the default, trusts none: `request.ip` is the socket's address). Behind CloudFront then the
 *   load balancer, 2: the address CloudFront saw, the entries before it being the viewer's own claims
 * @property trustCloudFrontViewerAddress - Whether the client address is read from the `CloudFront-Viewer-Address`
 *   header, which CloudFront sets itself (a viewer cannot forge it through CloudFront). Only in production behind
 *   CloudFront: anywhere else, anyone can send it
 */
export type HttpServerConfig = {
  host: string;
  port: number;
  corsOrigins: string[];
  trustProxyHops: number;
  trustCloudFrontViewerAddress: boolean;
};

/**
 * Read a comma-separated list of origins.
 *
 * @param value - `APP_CORS_ORIGINS`, e.g. `http://localhost:5173,https://app.omnipotent.app`; none when it is not a
 *   string
 * @returns The origins, without spaces, trailing slashes or empty entries
 *
 * @example
 * ```typescript
 * parseOrigins(' http://localhost:5173/ , '); // ['http://localhost:5173']
 * ```
 */
export function parseOrigins(value: unknown): string[] {
  return (typeof value === 'string' ? value : '')
    .split(',')
    .map((origin: string): string => origin.trim().replace(/\/+$/, ''))
    .filter((origin: string): boolean => origin.length > 0);
}

/**
 * The configuration key used to look up HTTP server settings in the config store.
 */
const CONFIG_KEY = 'HttpServer';

/**
 * Resolved HTTP server configuration loaded from the application config store.
 *
 * @example
 * ```typescript
 * import { httpServerConfig } from './configs';
 *
 * fastify.listen({ host: httpServerConfig.host, port: httpServerConfig.port });
 * ```
 */
export const httpServerConfig: HttpServerConfig = {
  host: config.get(`${CONFIG_KEY}.host`),
  port: config.get(`${CONFIG_KEY}.port`),
  corsOrigins: parseOrigins(config.get(`${CONFIG_KEY}.corsOrigins`)),
  trustProxyHops: config.has(`${CONFIG_KEY}.trustProxyHops`) ? Number(config.get(`${CONFIG_KEY}.trustProxyHops`)) : 0,
  trustCloudFrontViewerAddress: config.has(`${CONFIG_KEY}.trustCloudFrontViewerAddress`)
    ? config.get(`${CONFIG_KEY}.trustCloudFrontViewerAddress`) === true
    : false,
};
