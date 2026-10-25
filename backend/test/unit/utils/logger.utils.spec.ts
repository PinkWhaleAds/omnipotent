const ENV_MOCK: { ENV: string; IS_DEV_ENV: boolean; INSTANCE_ID: string } = {
  ...jest.requireActual('@constants/common.constants'),
  ENV: 'dev',
  IS_DEV_ENV: false,
  INSTANCE_ID: 'test-instance',
};
jest.mock('@constants/common.constants', (): { ENV: string; IS_DEV_ENV: boolean; INSTANCE_ID: string } => ENV_MOCK);

import { LoggerConfig } from '@configs';
const CONFIG_MOCK: LoggerConfig & { abc: string } = {
  ...jest.requireActual('@configs/logger.config'),
};
jest.mock('@configs/logger.config', () => ({
  loggerConfig: CONFIG_MOCK,
}));

import { WinstonMock } from '@test/unit/mocks/winston.mock';
import { LoggerBuilder, Logger } from '@utils/logger.utils';
import { sanitizeLogFormat } from '@utils/log-format.utils';
import { SafeMap } from '@src/types';

jest.mock('@utils/process.utils');

jest.mock('@configs');

jest.mock('winston', () => WinstonMock);

import winston from 'winston';
import { spyPrivateMethod } from '@test/utils';

describe('Unit::Utils::LoggerBuilder', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
    (LoggerBuilder as any).gLogger = undefined;
    (LoggerBuilder as any).aLogger = undefined;
    ENV_MOCK.IS_DEV_ENV = false;
  });

  describe('getLogger', () => {
    it('should create logger only once', (): void => {
      spyPrivateMethod(LoggerBuilder, 'getTransportList').mockImplementationOnce((): winston.transport[] => []);
      CONFIG_MOCK.level = 'info';
      const createLoggerSpy: jest.SpyInstance = jest.spyOn(winston, 'createLogger');

      const logger1: Logger = LoggerBuilder.getLogger();
      const logger2: Logger = LoggerBuilder.getLogger();

      expect(createLoggerSpy).toHaveBeenCalledTimes(1);
      expect(logger1).toBe(logger2);
    });

    it('should create logger with correct configuration', (): void => {
      CONFIG_MOCK.level = 'info';

      const createLoggerSpy: jest.SpyInstance = jest.spyOn(winston, 'createLogger');

      LoggerBuilder.getLogger();

      expect(createLoggerSpy).toHaveBeenCalledWith({
        level: 'info',
        format: sanitizeLogFormat,
        transports: expect.any(Array),
      });
    });

    it('should attach getChild method to logger', (): void => {
      const logger: Logger = LoggerBuilder.getLogger();
      expect(logger.getChild).toBeDefined();
      expect(logger.getChild).toBe(LoggerBuilder.getChildLogger);
    });
  });

  describe('getAccessLogger', () => {
    it('should create the access logger once, at info whatever the configured level', (): void => {
      CONFIG_MOCK.level = 'warn';
      const createLoggerSpy: jest.SpyInstance = jest.spyOn(winston, 'createLogger');

      const first: winston.Logger = LoggerBuilder.getAccessLogger();
      const second: winston.Logger = LoggerBuilder.getAccessLogger();

      expect(first).toBe(second);
      expect(createLoggerSpy).toHaveBeenCalledTimes(1);
      expect(createLoggerSpy).toHaveBeenCalledWith({
        level: 'info',
        format: sanitizeLogFormat,
        transports: expect.any(Array),
        defaultMeta: expect.objectContaining({ class: 'AccessLog', instanceId: 'test-instance', env: 'dev' }),
      });
      expect(WinstonMock.transports.Console).toHaveBeenCalledWith({ level: 'info', format: expect.any(Object) });
    });
  });

  describe('getChildLogger', () => {
    it('should create child logger with service name', (): void => {
      const childResult: Record<string, never> = {};
      const childSpy: jest.Mock = jest.fn().mockReturnValue(childResult);
      const mockLogger: { child: jest.Mock } = {
        child: childSpy,
      };
      jest.spyOn(LoggerBuilder, 'getLogger').mockReturnValue(mockLogger as any);

      const result: Logger = LoggerBuilder.getChildLogger('TestService');

      expect(childSpy).toHaveBeenCalledWith({
        class: 'TestService',
        instanceId: 'test-instance',
      });
      expect(result).toBe(childResult);
    });

    it('should create child logger with metadata', (): void => {
      const childResult: Record<string, never> = {};
      const childSpy: jest.Mock = jest.fn().mockReturnValue(childResult);
      const mockLogger: { child: jest.Mock } = {
        child: childSpy,
      };
      jest.spyOn(LoggerBuilder, 'getLogger').mockReturnValue(mockLogger as any);

      const metadata: SafeMap<string> = { key: 'value' };
      const result: Logger = LoggerBuilder.getChildLogger('TestService', metadata);

      expect(childSpy).toHaveBeenCalledWith({
        ...metadata,
        class: 'TestService',
        instanceId: 'test-instance',
      });
      expect(result).toBe(childResult);
    });
  });

  describe('getTransportList', () => {
    it('should create default transports', (): void => {
      CONFIG_MOCK.level = 'info';

      const transports: winston.transport[] = (LoggerBuilder as any).getTransportList();

      expect(transports).toHaveLength(1); // Console

      expect(winston.transports.Console).toHaveBeenCalledTimes(1);
    });

    it('should setup console log for PROD environment', (): void => {
      ENV_MOCK.IS_DEV_ENV = false;
      CONFIG_MOCK.level = 'warn';
      (LoggerBuilder as any).getTransportList();

      expect(WinstonMock.transports.Console).toHaveBeenCalledWith({
        level: 'warn',
        format: expect.any(Object),
      });
      expect(WinstonMock.format.timestamp).toHaveBeenCalled();
      expect(WinstonMock.format.json).toHaveBeenCalled();
    });

    it('should setup console log for DEV environment', (): void => {
      ENV_MOCK.IS_DEV_ENV = true;
      CONFIG_MOCK.level = 'info';
      (LoggerBuilder as any).getTransportList();

      expect(WinstonMock.transports.Console).toHaveBeenCalledWith({
        level: 'info',
        format: expect.any(Object),
      });
      expect(WinstonMock.format.timestamp).toHaveBeenCalled();
      expect(WinstonMock.format.simple).toHaveBeenCalled();
      expect(WinstonMock.format.colorize).toHaveBeenCalled();
    });
  });
});
