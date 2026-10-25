import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { Nullable } from '@src/types';
import { callPrivateMethod } from '@test/utils';
import { Server } from '@src/server/server';
import { callCallback } from '@src/utils';

class TestServer extends Server {
  listenApp: jest.Mock = jest.fn().mockImplementation(callCallback);
  closeApp: jest.Mock = jest.fn().mockImplementation(callCallback);
}

describe('Unit::Server', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  describe('listen', () => {
    it('should call listenApp method', (): void => {
      const server: TestServer = new TestServer();
      const initConfigsSpy: jest.SpyInstance = jest.spyOn(server, 'initConfigs').mockImplementationOnce((): void => {});

      callPrivateMethod(server, 'listen');
      expect(initConfigsSpy).toHaveBeenCalledTimes(1);
      expect(server.listenApp).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should call closeApp', (done: jest.DoneCallback): void => {
      const server: TestServer = new TestServer();

      server.stop((error: Nullable<Error> | undefined): void => {
        expect(error).toBeUndefined();
        expect(server.closeApp).toHaveBeenCalled();
        done();
      });
    });

    it('should log an error if closeApp throws', (done: jest.DoneCallback): void => {
      const server: TestServer = new TestServer();
      const error: Error = new Error('Service stop failed');
      server.closeApp = jest.fn().mockImplementation((cb: any): void => cb(error));
      server.stop((error: Nullable<Error> | undefined): void => {
        expect(error).toBe(error);
        expect(loggerMock.getLogger).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });

  describe('readiness hooks', () => {
    it('should be no-ops on the base class', (): void => {
      const server: TestServer = new TestServer();

      expect((): void => server.markReady()).not.toThrow();
      expect((): void => server.markNotReady()).not.toThrow();
    });
  });

  describe('initConfigs', () => {
    it('should be called during initialization', (): void => {
      const server: TestServer = new TestServer();

      callPrivateMethod(server, 'initConfigs');
    });
  });
});
