import config from 'config';

/**
 * Configuration interface for the API documentation.
 *
 * @property enabled - Whether the Swagger UI and the OpenAPI document (`/documentation`, `/documentation/json`) are
 *   served. On locally and in tests, where the front end generates its types from the local API (`pnpm api:types`);
 *   off in production (`config/prod.json`), where those routes answer 404
 */
export type DocsConfig = {
  enabled: boolean;
};

/** The configuration key used to look up the documentation settings in the config store. */
const CONFIG_KEY = 'Docs';

/**
 * Resolved documentation configuration loaded from the application config store. Off when the key is absent: the
 * documentation is only served where a configuration asks for it (`config/default.json` does, `config/prod.json`
 * does not; `APP_DOCS_ENABLED` overrides both).
 *
 * @example
 * ```typescript
 * import { docsConfig } from '@configs';
 *
 * if (docsConfig.enabled) await fastify.register(FastifySwaggerUi);
 * ```
 */
export const docsConfig: DocsConfig = {
  enabled: config.has(`${CONFIG_KEY}.enabled`) ? config.get(`${CONFIG_KEY}.enabled`) === true : false,
};
