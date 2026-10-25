import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
const killProcessSpy: jest.Mock = jest.fn();
const registerLifecycleHandlersSpy: jest.Mock = jest.fn();
jest.mock('@utils', () => ({
  ...jest.requireActual('@utils'),
  LoggerBuilder: loggerMock,
  killProcess: killProcessSpy,
  registerLifecycleHandlers: registerLifecycleHandlersSpy,
}));

/**
 * Import HttpServer and use jest to mock it.
 */
jest.mock('@src/server');
import { HttpServer } from '@src/server';

import { App } from '@src/app';
import { getPrivateProperty } from '@test/utils';

describe('Unit::App', () => {
  afterAll((): void => {
    jest.unmock('@src/server');
  });

  beforeEach((): void => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should instantiate a single HttpServer', (): void => {
      const app: App = new App();

      expect(HttpServer).toHaveBeenCalledTimes(1);
      expect(getPrivateProperty(app, 'server')).toBeDefined();
    });
  });

  describe('start', () => {
    it('should register the shutdown handlers then listen', async (): Promise<void> => {
      const spyListen: jest.Mock = jest.fn().mockResolvedValue(undefined);
      const spyMarkReady: jest.Mock = jest.fn();
      (HttpServer as jest.Mock).mockImplementationOnce((): { listen: jest.Mock; markReady: jest.Mock } => ({
        listen: spyListen,
        markReady: spyMarkReady,
      }));
      const app: App = new App();

      await app.start();

      expect(registerLifecycleHandlersSpy).toHaveBeenCalledWith(getPrivateProperty(app, 'server'));
      expect(spyListen).toHaveBeenCalled();
      expect(spyMarkReady).toHaveBeenCalledTimes(1);
      expect(killProcessSpy).not.toHaveBeenCalled();
    });

    it('should kill the process when the server fails to start', async (): Promise<void> => {
      const mockError: Error = new Error('Server start failed');
      const spyMarkReady: jest.Mock = jest.fn();
      (HttpServer as jest.Mock).mockImplementationOnce((): { listen: jest.Mock; markReady: jest.Mock } => ({
        listen: jest.fn().mockRejectedValue(mockError),
        markReady: spyMarkReady,
      }));
      const app: App = new App();

      await app.start();

      expect(killProcessSpy).toHaveBeenCalledWith('APP::START_FAILED', 'Failed to start server', mockError);
    });
  });
});
