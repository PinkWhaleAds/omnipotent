jest.mock('config');
import config from 'config';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Unit::Constants::CommonConstants', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  it('should treat an unknown NODE_ENV as PROD (fail closed) and warn', async (): Promise<void> => {
    const warnSpy: jest.SpyInstance = jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('staging');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { ENV, PROD, IS_DEV_ENV } = await import('@constants/common.constants');
      expect(ENV).toBe(PROD);
      expect(IS_DEV_ENV).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith('[WARN] Unknown environment, treated as PROD');
    });

    warnSpy.mockRestore();
  });

  it('should resolve "production" to PROD', async (): Promise<void> => {
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('production');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { ENV, PROD } = await import('@constants/common.constants');
      expect(ENV).toBe(PROD);
    });
  });

  it('should resolve "development" to DEV', async (): Promise<void> => {
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('development');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { ENV, DEV } = await import('@constants/common.constants');
      expect(ENV).toBe(DEV);
    });
  });

  it('should resolve "test" to TEST', async (): Promise<void> => {
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('test');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { ENV, TEST } = await import('@constants/common.constants');
      expect(ENV).toBe(TEST);
    });
  });

  it('should handle case-insensitive NODE_ENV', async (): Promise<void> => {
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('PROD');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { ENV, PROD } = await import('@constants/common.constants');
      expect(ENV).toBe(PROD);
    });
  });

  it('should treat an empty NODE_ENV as PROD', async (): Promise<void> => {
    const warnSpy: jest.SpyInstance = jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { ENV, PROD } = await import('@constants/common.constants');
      expect(ENV).toBe(PROD);
      expect(warnSpy).toHaveBeenCalled();
    });

    warnSpy.mockRestore();
  });

  it('should fallback APP_NAME to package.json name when npm_package_name is not set', async (): Promise<void> => {
    const originalName: string | undefined = process.env.npm_package_name;
    delete process.env.npm_package_name;
    const dir: string = mkdtempSync(join(tmpdir(), 'app-meta-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pkg-json-name', version: '1.2.3' }));
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');
    jest.spyOn(process, 'cwd').mockReturnValue(dir);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { APP_NAME } = await import('@constants/common.constants');
      expect(APP_NAME).toBe('pkg-json-name');
    });

    rmSync(dir, { recursive: true, force: true });
    process.env.npm_package_name = originalName;
  });

  it('should fallback APP_NAME to literal when neither env nor package.json available', async (): Promise<void> => {
    const originalName: string | undefined = process.env.npm_package_name;
    delete process.env.npm_package_name;
    const dir: string = mkdtempSync(join(tmpdir(), 'app-meta-'));
    // no package.json written — cwd points to an empty dir
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');
    jest.spyOn(process, 'cwd').mockReturnValue(dir);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { APP_NAME } = await import('@constants/common.constants');
      expect(APP_NAME).toBe('omnipotent');
    });

    rmSync(dir, { recursive: true, force: true });
    process.env.npm_package_name = originalName;
  });

  it('should fallback APP_NAME to literal when package.json parses but has no string name', async (): Promise<void> => {
    // Exercises the inner ternary's false branch in readAppMeta — package.json is
    // present and parses, but `name` is missing / non-string, so the typeof check
    // falls through to the hardcoded literal without entering the catch block.
    const originalName: string | undefined = process.env.npm_package_name;
    delete process.env.npm_package_name;
    const dir: string = mkdtempSync(join(tmpdir(), 'app-meta-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');
    jest.spyOn(process, 'cwd').mockReturnValue(dir);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { APP_NAME } = await import('@constants/common.constants');
      expect(APP_NAME).toBe('omnipotent');
    });

    rmSync(dir, { recursive: true, force: true });
    process.env.npm_package_name = originalName;
  });

  it('should fallback APP_VERSION to package.json version when npm_package_version is not set', async (): Promise<void> => {
    const originalVersion: string | undefined = process.env.npm_package_version;
    const originalSha: string | undefined = process.env.COMMIT_SHA;
    delete process.env.npm_package_version;
    delete process.env.COMMIT_SHA;
    const dir: string = mkdtempSync(join(tmpdir(), 'app-meta-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pkg-json-name', version: '1.2.3' }));
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');
    jest.spyOn(process, 'cwd').mockReturnValue(dir);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { APP_VERSION } = await import('@constants/common.constants');
      expect(APP_VERSION).toBe('1.2.3');
    });

    rmSync(dir, { recursive: true, force: true });
    process.env.npm_package_version = originalVersion;
    if (originalSha !== undefined) process.env.COMMIT_SHA = originalSha;
  });

  it('should fallback APP_VERSION to 0.0.0 when neither env nor package.json available', async (): Promise<void> => {
    const originalVersion: string | undefined = process.env.npm_package_version;
    const originalSha: string | undefined = process.env.COMMIT_SHA;
    delete process.env.npm_package_version;
    delete process.env.COMMIT_SHA;
    const dir: string = mkdtempSync(join(tmpdir(), 'app-meta-'));
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');
    jest.spyOn(process, 'cwd').mockReturnValue(dir);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { APP_VERSION } = await import('@constants/common.constants');
      expect(APP_VERSION).toBe('0.0.0');
    });

    rmSync(dir, { recursive: true, force: true });
    process.env.npm_package_version = originalVersion;
    if (originalSha !== undefined) process.env.COMMIT_SHA = originalSha;
  });

  it('should fallback APP_VERSION to 0.0.0 when package.json parses but has no string version', async (): Promise<void> => {
    // Exercises the inner ternary's false branch in readAppMeta — package.json is
    // present and parses, but `version` is missing / non-string, so the typeof check
    // falls through to the hardcoded literal without entering the catch block.
    const originalVersion: string | undefined = process.env.npm_package_version;
    const originalSha: string | undefined = process.env.COMMIT_SHA;
    delete process.env.npm_package_version;
    delete process.env.COMMIT_SHA;
    const dir: string = mkdtempSync(join(tmpdir(), 'app-meta-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pkg-json-name' }));
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');
    jest.spyOn(process, 'cwd').mockReturnValue(dir);

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { APP_VERSION } = await import('@constants/common.constants');
      expect(APP_VERSION).toBe('0.0.0');
    });

    rmSync(dir, { recursive: true, force: true });
    process.env.npm_package_version = originalVersion;
    if (originalSha !== undefined) process.env.COMMIT_SHA = originalSha;
  });

  it('should suffix APP_VERSION with COMMIT_SHA when set', async (): Promise<void> => {
    const originalVersion: string | undefined = process.env.npm_package_version;
    const originalSha: string | undefined = process.env.COMMIT_SHA;
    process.env.npm_package_version = '1.2.3';
    process.env.COMMIT_SHA = 'abc1234';
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { APP_VERSION } = await import('@constants/common.constants');
      expect(APP_VERSION).toBe('1.2.3-abc1234');
    });

    process.env.npm_package_version = originalVersion;
    if (originalSha === undefined) {
      delete process.env.COMMIT_SHA;
    } else {
      process.env.COMMIT_SHA = originalSha;
    }
  });

  it('should use npm_package_name when set', async (): Promise<void> => {
    const originalName: string | undefined = process.env.npm_package_name;
    process.env.npm_package_name = 'test-app';
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { APP_NAME } = await import('@constants/common.constants');
      expect(APP_NAME).toBe('test-app');
    });

    process.env.npm_package_name = originalName;
  });

  it('should use HOSTNAME as INSTANCE_ID when set', async (): Promise<void> => {
    const originalHostname: string | undefined = process.env.HOSTNAME;
    process.env.HOSTNAME = 'my-api-7d9c8b6f4-x2klm';
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      const { INSTANCE_ID } = await import('@constants/common.constants');
      expect(INSTANCE_ID).toBe('my-api-7d9c8b6f4-x2klm');
    });

    if (originalHostname === undefined) delete process.env.HOSTNAME;
    else process.env.HOSTNAME = originalHostname;
  });

  it('should fall back to the machine hostname when HOSTNAME is not set', async (): Promise<void> => {
    const originalHostname: string | undefined = process.env.HOSTNAME;
    delete process.env.HOSTNAME;
    jest.spyOn(console, 'warn').mockImplementation((): void => {});
    jest.spyOn(config.util, 'getEnv').mockReturnValue('dev');

    await jest.isolateModulesAsync(async (): Promise<void> => {
      jest.doMock('node:os', () => ({
        ...jest.requireActual('node:os'),
        hostname: (): string => 'local-machine',
      }));
      const { INSTANCE_ID } = await import('@constants/common.constants');
      expect(INSTANCE_ID).toBe('local-machine');
    });

    if (originalHostname !== undefined) process.env.HOSTNAME = originalHostname;
  });
});
