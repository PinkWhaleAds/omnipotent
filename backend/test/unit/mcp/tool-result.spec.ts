import { LoggerMock } from '@test/unit/mocks/logger.mock';
const loggerMock: LoggerMock = new LoggerMock();
jest.mock('@utils/logger.utils', () => ({
  ...jest.requireActual('@utils/logger.utils'),
  LoggerBuilder: loggerMock,
}));

import { resolveOrganizationId, runTool, toolResult, McpToolResult } from '@src/mcp/tool-result';
import { errorCodeOf, httpError, statusCodeOf } from '@utils';
import { IDS, JANE } from '@test/unit/mocks/auth.fixtures';

const INTERNAL_ERROR_MESSAGE = 'Internal error, please retry later';
const ORGANIZATION_REQUIRED_MESSAGE =
  'organizationId is required: call get-me and pass the id of one of its Organizations';

/**
 * Run a function expected to throw and return what it threw.
 *
 * @param fn - The function to run
 * @returns The thrown value
 */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the function to throw');
}

describe('Unit::Mcp::ToolResult', () => {
  beforeEach((): void => {
    jest.clearAllMocks();
  });

  describe('toolResult', () => {
    it('should return the payload as JSON text and as structured content', (): void => {
      const payload: { id: string; name: string } = { id: IDS.advertiser, name: 'Acme' };

      const result: McpToolResult = toolResult(payload);

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload,
      });
      expect(result.structuredContent).toBe(payload);
      expect(result.isError).toBeUndefined();
    });
  });

  describe('runTool', () => {
    it('should wrap the resolved payload into a successful result', async (): Promise<void> => {
      const payload: { deleted: boolean; id: string } = { deleted: true, id: IDS.seat };

      const result: McpToolResult = await runTool(async (): Promise<object> => payload);

      expect(result).toEqual(toolResult(payload));
      expect(loggerMock.error).not.toHaveBeenCalled();
    });

    it.each([400, 403, 404, 409, 499])(
      'should return the message of a %i error as a tool error without logging it',
      async (statusCode: number): Promise<void> => {
        const result: McpToolResult = await runTool(async (): Promise<object> => {
          throw httpError(statusCode, 'Organization not found');
        });

        expect(result).toEqual({ content: [{ type: 'text', text: 'Organization not found' }], isError: true });
        expect(result.structuredContent).toBeUndefined();
        expect(loggerMock.error).not.toHaveBeenCalled();
      }
    );

    it('should also catch an error thrown synchronously by the body', async (): Promise<void> => {
      const result: McpToolResult = await runTool((): Promise<object> => {
        throw httpError(400, 'Bad input');
      });

      expect(result).toEqual({ content: [{ type: 'text', text: 'Bad input' }], isError: true });
    });

    it.each([500, 502, 503])(
      'should hide the message of a %i error and log it',
      async (statusCode: number): Promise<void> => {
        const error: Error = httpError(statusCode, 'connect ECONNREFUSED postgres://user:secret@db:5432');

        const result: McpToolResult = await runTool(async (): Promise<object> => {
          throw error;
        });

        expect(result).toEqual({ content: [{ type: 'text', text: INTERNAL_ERROR_MESSAGE }], isError: true });
        expect(loggerMock.error).toHaveBeenCalledTimes(1);
        expect(loggerMock.error).toHaveBeenCalledWith('An MCP tool failed unexpectedly', {
          code: 'MCP::TOOL_FAILED',
          error,
        });
      }
    );

    it('should hide the message of a plain Error and log it', async (): Promise<void> => {
      const error: Error = new Error('relation "advertisers" does not exist');

      const result: McpToolResult = await runTool(async (): Promise<object> => {
        throw error;
      });

      expect(result).toEqual({ content: [{ type: 'text', text: INTERNAL_ERROR_MESSAGE }], isError: true });
      expect(loggerMock.error).toHaveBeenCalledWith('An MCP tool failed unexpectedly', {
        code: 'MCP::TOOL_FAILED',
        error,
      });
    });

    it('should treat a non-numeric statusCode as an unexpected failure', async (): Promise<void> => {
      const error: Error & { statusCode: string } = Object.assign(new Error('weird'), { statusCode: '404' });

      const result: McpToolResult = await runTool(async (): Promise<object> => {
        throw error;
      });

      expect(result.content[0].text).toBe(INTERNAL_ERROR_MESSAGE);
      expect(loggerMock.error).toHaveBeenCalledWith('An MCP tool failed unexpectedly', {
        code: 'MCP::TOOL_FAILED',
        error,
      });
    });

    it('should treat a thrown non-Error value as an unexpected failure', async (): Promise<void> => {
      const result: McpToolResult = await runTool(async (): Promise<object> => {
        throw 'boom';
      });

      expect(result).toEqual({ content: [{ type: 'text', text: INTERNAL_ERROR_MESSAGE }], isError: true });
      expect(loggerMock.error).toHaveBeenCalledWith('An MCP tool failed unexpectedly', {
        code: 'MCP::TOOL_FAILED',
        error: 'boom',
      });
    });
  });

  describe('resolveOrganizationId', () => {
    it('should return the organizationId argument when given', (): void => {
      expect(resolveOrganizationId({ auth: JANE }, IDS.organization)).toBe(IDS.organization);
    });

    it('should prefer the argument over the organization of the connection', (): void => {
      expect(resolveOrganizationId({ auth: JANE, organizationId: IDS.otherOrganization }, IDS.organization)).toBe(
        IDS.organization
      );
    });

    it('should fall back to the organization of the connection', (): void => {
      expect(resolveOrganizationId({ auth: JANE, organizationId: IDS.otherOrganization })).toBe(IDS.otherOrganization);
    });

    it('should throw a 400 when neither the argument nor the connection names an organization', (): void => {
      const error: unknown = thrownBy((): string => resolveOrganizationId({ auth: JANE }));

      expect(error).toBeInstanceOf(Error);
      expect(statusCodeOf(error)).toBe(400);
      expect((error as Error).message).toBe(ORGANIZATION_REQUIRED_MESSAGE);
      expect(errorCodeOf(error)).toEqual({ code: 'organization_id_required', params: {} });
    });

    it('should throw a 400 when the organization of the connection is empty', (): void => {
      const error: unknown = thrownBy((): string => resolveOrganizationId({ auth: JANE, organizationId: '' }));

      expect(statusCodeOf(error)).toBe(400);
    });

    it('should turn the missing organization into a tool error once run by runTool', async (): Promise<void> => {
      const result: McpToolResult = await runTool(async (): Promise<object> => ({
        id: resolveOrganizationId({ auth: JANE }),
      }));

      expect(result).toEqual({ content: [{ type: 'text', text: ORGANIZATION_REQUIRED_MESSAGE }], isError: true });
      expect(loggerMock.error).not.toHaveBeenCalled();
    });
  });
});
