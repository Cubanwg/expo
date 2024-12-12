import { vol } from 'memfs';
import console from 'node:console';
import process from 'node:process';

// import { createControlledEnvironment, getFiles } from '../env';
import { getEnvFiles, LOADED_ENV_NAME, loadProjectEnv, parseProjectEnv } from '../index-new';

jest.mock('node:console', () => {
  const console = jest.requireActual('node:console');
  return { ...console, error: jest.fn(console.error), warn: jest.fn(console.warn) };
});

/** The original reference to `process.env`, containing the actual environment variables. */
const originalEnv = process.env as Readonly<NodeJS.ProcessEnv>;

beforeEach(() => {
  vol.reset();
  // Mock the environment variables, to be edited within tests
  process.env = { ...originalEnv } as NodeJS.ProcessEnv;
});
afterAll(() => {
  // Clear the mocked environment, reusing the original object instance
  process.env = originalEnv;
});

describe(getEnvFiles, () => {
  it(`gets development files`, () => {
    expect(getEnvFiles({ mode: 'development' })).toEqual([
      '.env.development.local',
      '.env.local',
      '.env.development',
      '.env',
    ]);
  });

  it(`gets production files`, () => {
    expect(getEnvFiles({ mode: 'production' })).toEqual([
      '.env.production.local',
      '.env.local',
      '.env.production',
      '.env',
    ]);
  });

  it(`gets test files`, () => {
    // important
    expect(getEnvFiles({ mode: 'test' })).toEqual(['.env.test.local', '.env.test', '.env']);
  });

  it(`gets no files when dotenv is disabled`, () => {
    process.env.EXPO_NO_DOTENV = '1';

    expect(getEnvFiles({ mode: 'test' })).toEqual([]);
    expect(getEnvFiles({ mode: 'development' })).toEqual([]);
    expect(getEnvFiles({ mode: 'production' })).toEqual([]);
  });

  it(`uses NODE_ENV as mode by default`, () => {
    process.env.NODE_ENV = 'development';

    expect(getEnvFiles()).toEqual([
      '.env.development.local',
      '.env.local',
      '.env.development',
      '.env',
    ]);
  });

  it(`errors if NODE_ENV is not set`, () => {
    delete process.env.NODE_ENV;
    jest.mocked(console.error).mockImplementation();

    getEnvFiles();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('The NODE_ENV environment variable is required but was not specified')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Using only .env.local and .env')
    );
  });
  it(`warns if NODE_ENV is not valid`, () => {
    process.env.NODE_ENV = 'invalid';
    jest.mocked(console.warn).mockImplementation();

    expect(() => getEnvFiles()).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('NODE_ENV="invalid" is non-conventional')
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Use "development", "test", or "production"')
    );
  });
  it(`does not warn if NODE_ENV is not valid when in silent mode`, () => {
    process.env.NODE_ENV = 'invalid';
    jest.mocked(console.warn).mockImplementation();

    expect(() => getEnvFiles({ silent: true })).not.toThrow();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe(parseProjectEnv, () => {
  it('parses .env file without mutating system environment variables', () => {
    vol.fromJSON({ '.env': 'FOO=bar' }, '/');
    expect(parseProjectEnv('/')).toEqual({
      env: { FOO: 'bar' },
      files: ['/.env'],
    });
    expect(process.env['FOO']).toBeUndefined();
  });

  it(`cascades env files (development)`, () => {
    process.env.NODE_ENV = 'development';
    vol.fromJSON(
      {
        '.env': 'FOO=default',
        '.env.local': 'FOO=default-local',
        '.env.development': 'FOO=dev',
        '.env.production': 'FOO=prod',
        '.env.production.local': 'FOO=prod-local',
        '.env.development.local': 'FOO=dev-local',
      },
      '/'
    );

    expect(parseProjectEnv('/')).toEqual({
      files: ['/.env.development.local', '/.env.local', '/.env.development', '/.env'],
      env: {
        FOO: 'dev-local',
      },
    });
  });

  it(`cascades env files (production)`, () => {
    process.env.NODE_ENV = 'production';
    vol.fromJSON(
      {
        '.env': 'FOO=default',
        '.env.local': 'FOO=default-local',
        '.env.production': 'FOO=prod',
        '.env.production.local': 'FOO=prod-local',
      },
      '/'
    );

    expect(parseProjectEnv('/')).toEqual({
      files: ['/.env.production.local', '/.env.local', '/.env.production', '/.env'],
      env: {
        FOO: 'prod-local',
      },
    });
  });

  it(`cascades env files (test)`, () => {
    process.env.NODE_ENV = 'test'; // Jest is setting `NODE_ENV=test`, just for clarity
    vol.fromJSON(
      {
        '.env': 'FOO=default',
        '.env.local': 'FOO=default-local',
      },
      '/'
    );

    expect(parseProjectEnv('/')).toEqual({
      files: ['/.env'],
      env: {
        FOO: 'default',
      },
    });
  });

  it(`cascades env files (default)`, () => {
    delete process.env.NODE_ENV; // Jest is setting `NODE_ENV=test`, make sure to unset it
    jest.mocked(console.error).mockImplementation();
    vol.fromJSON(
      {
        '.env': 'FOO=default',
        '.env.local': 'FOO=default-local',
      },
      '/'
    );

    expect(parseProjectEnv('/')).toEqual({
      files: ['/.env.local', '/.env'],
      env: {
        FOO: 'default-local',
      },
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Using only .env.local and .env')
    );
  });

  it('expands variables', () => {
    process.env.USER_DEFINED = 'user-defined';
    vol.fromJSON(
      {
        '.env': 'TEST_EXPAND=${USER_DEFINED}',
      },
      '/'
    );

    expect(parseProjectEnv('/')).toEqual({
      files: ['/.env'],
      env: {
        TEST_EXPAND: 'user-defined',
      },
    });
  });

  it('expands variables from cascading env files (development)', () => {
    process.env.USER_DEFINED = 'user-defined';
    process.env.NODE_ENV = 'development';
    vol.fromJSON(
      {
        '.env': ['TEST_EXPAND=.env', 'TEST_VALUE_ENV=test'].join('\n'),
        '.env.development': [
          'TEST_EXPAND=.env.development',
          'TEST_INTERMEDIATE=${TEST_VALUE_ENV}',
        ].join('\n'),
        '.env.local': ['TEST_EXPAND=${USER_DEFINED}'].join('\n'),
      },
      '/'
    );

    expect(parseProjectEnv('/')).toEqual({
      files: ['/.env.local', '/.env.development', '/.env'],
      env: {
        TEST_EXPAND: 'user-defined',
        TEST_VALUE_ENV: 'test',
        TEST_INTERMEDIATE: 'test',
      },
    });
  });

  it('expands variables safely without recursive loop', () => {
    process.env.USER_DEFINED = 'user-defined';
    vol.fromJSON(
      {
        // This should not expand to itself, causing a recursive loop
        '.env': 'TEST_EXPAND=${TEST_EXPAND}',
      },
      '/'
    );

    expect(parseProjectEnv('/')).toEqual({
      files: ['/.env'],
      env: {
        TEST_EXPAND: '${TEST_EXPAND}',
      },
    });
  });

  it(`skips parsing the environment with dotenv if disabled with EXPO_NO_DOTENV`, () => {
    process.env.EXPO_NO_DOTENV = '1';
    vol.fromJSON(
      {
        '.env': 'FOO=default',
        '.env.local': 'FOO=default-local',
      },
      '/'
    );

    expect(parseProjectEnv('/')).toEqual({ env: {}, files: [] });
  });

  it(`does not fail when no files are available`, () => {
    vol.fromJSON({}, '/');
    expect(parseProjectEnv('/')).toEqual({
      env: {},
      files: [],
    });
  });

  it(`does not assert on invalid env files`, () => {
    vol.fromJSON(
      {
        '.env': 'ˆ˙•ª∆ø…ˆ',
      },
      '/'
    );

    expect(parseProjectEnv('/')).toEqual({ env: {}, files: ['/.env'] });
  });
});

describe(loadProjectEnv, () => {
  it('parses .env file with mutating system environment variables', () => {
    delete process.env.FOO;
    vol.fromJSON({ '.env': 'FOO=bar' }, '/');

    expect(loadProjectEnv('/')).toEqual({
      result: 'loaded',
      env: { FOO: 'bar' },
      files: ['/.env'],
      loaded: ['FOO'],
    });

    expect(process.env['FOO']).toBe('bar');
  });

  it('does not mutate when the system environment is marked as loaded', () => {
    process.env[LOADED_ENV_NAME] = JSON.stringify(['FOO']);
    process.env.FOO = 'previous';
    vol.fromJSON({ '.env': 'FOO=bar' }, '/');

    expect(loadProjectEnv('/')).toEqual({
      result: 'skipped',
      loaded: ['FOO'],
    });
    expect(process.env['FOO']).toBe('previous');
  });

  it('mutates without overwriting after previous mutation when using force', () => {
    process.env[LOADED_ENV_NAME] = JSON.stringify(['FOO']);
    process.env.FOO = 'previous';
    vol.fromJSON({ '.env': 'FOO=bar' }, '/');

    expect(loadProjectEnv('/', { force: true })).toEqual({
      result: 'loaded',
      env: { FOO: 'previous' },
      files: ['/.env'],
      loaded: [],
    });
    expect(process.env['FOO']).toBe('previous');
  });
});

it('does not leak environment variables between tests', () => {
  // If this test fails, it means that the test environment is not set-up properly.
  // Environment variables are leaking between "originalEnv" and "process.env", causing unexpected test failures/passes.
  expect(originalEnv.INTERNAL_LEAK_TEST).toBeUndefined();

  process.env.INTERNAL_LEAK_TEST = 'changed';

  expect(process.env.INTERNAL_LEAK_TEST).toBe('changed');
  expect(originalEnv.INTERNAL_LEAK_TEST).toBeUndefined();
});
