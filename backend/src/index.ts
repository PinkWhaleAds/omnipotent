/**
 * @module index
 *
 * Application entry point. Creates and starts the App instance,
 * which registers the shutdown handlers and starts the HTTP server.
 */
import { App } from './app';

/** The main application instance that orchestrates the servers */
const app: App = new App();
void app.start();
