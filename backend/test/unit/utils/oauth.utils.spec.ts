import {
  PROTECTED_RESOURCE_METADATA_PREFIX,
  protectedResourceMetadataPath,
  protectedResourceMetadataUrl,
} from '@utils';

describe('Unit::Utils::OAuth', () => {
  it('should expose the RFC 9728 well-known prefix', (): void => {
    expect(PROTECTED_RESOURCE_METADATA_PREFIX).toBe('/.well-known/oauth-protected-resource');
  });

  describe('protectedResourceMetadataPath', () => {
    it.each([
      ['https://api.example.com/mcp', '/.well-known/oauth-protected-resource/mcp'],
      ['https://api.example.com/v1/mcp', '/.well-known/oauth-protected-resource/v1/mcp'],
      ['http://localhost:3000/mcp', '/.well-known/oauth-protected-resource/mcp'],
    ])('should insert the prefix before the path of %s', (resourceUrl: string, expected: string): void => {
      expect(protectedResourceMetadataPath(resourceUrl)).toBe(expected);
    });

    it.each(['https://api.example.com', 'https://api.example.com/'])(
      'should answer the bare prefix for the root resource %s',
      (resourceUrl: string): void => {
        expect(protectedResourceMetadataPath(resourceUrl)).toBe('/.well-known/oauth-protected-resource');
      }
    );

    it('should throw for a relative URL', (): void => {
      expect((): string => protectedResourceMetadataPath('/mcp')).toThrow('Invalid URL');
    });
  });

  describe('protectedResourceMetadataUrl', () => {
    it.each([
      ['https://api.example.com/mcp', 'https://api.example.com/.well-known/oauth-protected-resource/mcp'],
      ['http://localhost:3000/mcp', 'http://localhost:3000/.well-known/oauth-protected-resource/mcp'],
      ['https://api.example.com/', 'https://api.example.com/.well-known/oauth-protected-resource'],
    ])('should build the absolute metadata URL of %s', (resourceUrl: string, expected: string): void => {
      expect(protectedResourceMetadataUrl(resourceUrl)).toBe(expected);
    });
  });
});
