import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

const CONFIG_MOCK: { shutdownTimeout: number; drainDelay: number } = { shutdownTimeout: 5000, drainDelay: 0 };
jest.mock('@configs', () => ({
  ...jest.requireActual('@configs'),
  appConfig: CONFIG_MOCK,
}));

import { Callback, Nullable } from '@src/types';
import { killProcess, registerLifecycleHandlers, Terminable } from '@utils';

/** A terminable whose `stop` callback is invoked manually by each test. */
class TerminableMock implements Terminable {
  markNotReady: jest.Mock = jest.fn();
  stop: jest.Mock = jest.fn();

  /** Invokes the callback captured by the last `stop` call. */
  complete(error?: Nullable<Error>): void {
    const callback: Callback = this.stop.mock.calls[this.stop.mock.calls.length - 1][0];
    callback(error);
  }
}

describe('Unit::Utils::Process', () => {
  let exitSpy: jest.SpyInstance;
  /** Exit code of the jest process, which killProcess sets: restored so it cannot fail the run. */
  let exitCode: number | string | null | undefined;

  beforeEach((): void => {
    exitCode = process.exitCode;
    jest.clearAllMocks();
    jest.useFakeTimers();
    CONFIG_MOCK.shutdownTimeout = 5000;
    CONFIG_MOCK.drainDelay = 0;
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((): never => undefined as never);
  });

  afterEach((): void => {
    jest.useRealTimers();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    exitSpy.mockRestore();
    process.exitCode = exitCode;
  });

  describe('signals', () => {
    it('should listen for SIGTERM and SIGINT', (): void => {
      const target: TerminableMock = new TerminableMock();
      const onSpy: jest.SpyInstance = jest.spyOn(process, 'on');

      registerLifecycleHandlers(target);

      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      onSpy.mockRestore();
    });

    it('should stop the target and exit with code 0 on SIGTERM', (): void => {
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('SIGTERM', 'SIGTERM');
      expect(loggerMock.info).toHaveBeenCalledWith('Received SIGTERM, shutting down gracefully');
      expect(target.stop).toHaveBeenCalledTimes(1);

      target.complete();
      expect(loggerMock.info).toHaveBeenCalledWith('Shutdown complete');
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('should exit with code 1 when the target fails to stop', (): void => {
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('SIGINT', 'SIGINT');
      target.complete(new Error('close failed'));

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should ignore signals received while already shutting down', (): void => {
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('SIGTERM', 'SIGTERM');
      process.emit('SIGTERM', 'SIGTERM');
      process.emit('SIGINT', 'SIGINT');

      expect(target.stop).toHaveBeenCalledTimes(1);
    });

    it('should fail the readiness probe before closing the server', (): void => {
      const target: TerminableMock = new TerminableMock();
      const order: string[] = [];
      target.markNotReady.mockImplementation((): void => {
        order.push('markNotReady');
      });
      target.stop.mockImplementation((): void => {
        order.push('stop');
      });
      registerLifecycleHandlers(target);

      process.emit('SIGTERM', 'SIGTERM');

      expect(order).toEqual(['markNotReady', 'stop']);
    });

    it('should wait for the drain delay before closing the server', (): void => {
      CONFIG_MOCK.drainDelay = 5000;
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('SIGTERM', 'SIGTERM');

      // Readiness fails immediately, but the server keeps serving.
      expect(target.markNotReady).toHaveBeenCalledTimes(1);
      expect(loggerMock.info).toHaveBeenCalledWith('Draining for 5000ms before closing');
      expect(target.stop).not.toHaveBeenCalled();

      jest.advanceTimersByTime(4999);
      expect(target.stop).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(target.stop).toHaveBeenCalledTimes(1);

      target.complete();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('should not wait when the drain delay is zero', (): void => {
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('SIGTERM', 'SIGTERM');

      expect(target.stop).toHaveBeenCalledTimes(1);
      expect(loggerMock.info).not.toHaveBeenCalledWith(expect.stringContaining('Draining'));
    });

    it('should force the exit even if the drain delay outlives the shutdown timeout', (): void => {
      CONFIG_MOCK.drainDelay = 30000;
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('SIGTERM', 'SIGTERM');
      jest.advanceTimersByTime(5000);

      expect(target.stop).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should force the exit when the shutdown exceeds the timeout', (): void => {
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('SIGTERM', 'SIGTERM');
      expect(exitSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5000);

      expect(loggerMock.error).toHaveBeenCalledWith('Shutdown did not complete within 5000ms, forcing exit', {
        code: 'PROCESS::SHUTDOWN_TIMEOUT',
      });
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should clear the force exit timer once the target is stopped', (): void => {
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('SIGTERM', 'SIGTERM');
      target.complete();
      exitSpy.mockClear();

      jest.advanceTimersByTime(5000);

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('fatal errors', () => {
    it('should close and exit 1 on an uncaught exception, without draining', (): void => {
      CONFIG_MOCK.drainDelay = 5000;
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);
      const error: Error = new Error('kaboom');

      process.emit('uncaughtException', error);

      expect(loggerMock.error).toHaveBeenCalledWith('Uncaught exception, shutting down', {
        code: 'PROCESS::UNCAUGHT_EXCEPTION',
        error,
      });
      // No drain: the process state is not trustworthy, so it closes immediately.
      expect(target.markNotReady).toHaveBeenCalledTimes(1);
      expect(target.stop).toHaveBeenCalledTimes(1);

      target.complete();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should close and exit 1 on an unhandled rejection', (): void => {
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('unhandledRejection', new Error('nope'), Promise.resolve());

      expect(target.stop).toHaveBeenCalledTimes(1);
      target.complete();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should wrap a non-Error rejection reason', (): void => {
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('unhandledRejection', 'just a string', Promise.resolve());

      expect(loggerMock.error).toHaveBeenCalledWith('Unhandled promise rejection, shutting down', {
        code: 'PROCESS::UNHANDLED_REJECTION',
        error: expect.objectContaining({ message: 'just a string' }),
      });
    });

    it('should ignore a fatal error raised while already shutting down', (): void => {
      const target: TerminableMock = new TerminableMock();
      registerLifecycleHandlers(target);

      process.emit('SIGTERM', 'SIGTERM');
      process.emit('uncaughtException', new Error('during shutdown'));

      expect(target.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('killProcess', () => {
    it('should log then exit with code 1', (): void => {
      const error: Error = new Error('boom');

      killProcess('UNKNOWN', 'description', error);

      expect(loggerMock.error).toHaveBeenCalledWith('Was asked to kill process', {
        code: 'UNKNOWN',
        description: 'description',
        error,
      });
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should set exitCode up front so a logger that never flushes still fails', (): void => {
      killProcess('UNKNOWN');

      expect(process.exitCode).toBe(1);
    });
  });
});
