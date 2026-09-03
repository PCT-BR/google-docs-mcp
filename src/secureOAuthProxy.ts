import {
  OAuthProxy,
  OAuthProxyError,
  type AuthorizationParams,
  type DCRRequest,
  type DCRResponse,
  type OAuthProxyConfig,
} from 'fastmcp/auth';

const UNSAFE_REDIRECT_PATTERNS = new Set([
  'http://*',
  'https://*',
  'http://*:*',
  'https://*:*',
  '*',
]);

export function parseAdditionalRedirectUriPatterns(value?: string): string[] {
  if (!value?.trim()) return [];

  return value
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => {
      if (UNSAFE_REDIRECT_PATTERNS.has(pattern)) {
        throw new Error(`Redirect URI pattern is too broad: ${pattern}`);
      }
      if (!pattern.includes('://')) {
        throw new Error(`Redirect URI pattern must include a scheme: ${pattern}`);
      }
      return pattern;
    });
}

/**
 * Adapts FastMCP's OAuth proxy for public MCP clients without exposing the
 * upstream Google client secret through Dynamic Client Registration.
 */
export class SecureOAuthProxy extends OAuthProxy {
  private readonly allowedRedirectUriPatterns: string[];

  constructor(config: OAuthProxyConfig) {
    super(config);
    this.allowedRedirectUriPatterns = config.allowedRedirectUriPatterns ?? [];
  }

  override async authorize(params: AuthorizationParams): Promise<Response> {
    if (!params.code_challenge || params.code_challenge_method !== 'S256') {
      throw new OAuthProxyError(
        'invalid_request',
        'PKCE with code_challenge_method=S256 is required'
      );
    }

    // FastMCP keeps dynamic client registrations in memory. Remote clients such
    // as LibreChat may cache their registration across a Railway restart, so
    // restore the exact callback after validating it against the server allowlist.
    if (!this.isAllowedRedirectUri(params.redirect_uri)) {
      throw new OAuthProxyError(
        'invalid_redirect_uri',
        `Invalid redirect URI: ${params.redirect_uri}`
      );
    }
    await super.registerClient({
      redirect_uris: [params.redirect_uri],
      token_endpoint_auth_method: 'none',
    });

    return super.authorize(params);
  }

  override async registerClient(request: DCRRequest): Promise<DCRResponse> {
    for (const uri of request.redirect_uris) {
      if (!this.isAllowedRedirectUri(uri)) {
        throw new OAuthProxyError('invalid_redirect_uri', `Invalid redirect URI: ${uri}`);
      }
    }

    const response = await super.registerClient({
      ...request,
      token_endpoint_auth_method: 'none',
    });

    const {
      client_secret: _secret,
      client_secret_expires_at: _expiresAt,
      ...publicResponse
    } = response;

    return {
      ...publicResponse,
      token_endpoint_auth_method: 'none',
    };
  }

  override getAuthorizationServerMetadata(): ReturnType<
    OAuthProxy['getAuthorizationServerMetadata']
  > {
    return {
      ...super.getAuthorizationServerMetadata(),
      tokenEndpointAuthMethodsSupported: ['none'],
    };
  }

  private isAllowedRedirectUri(uri: string): boolean {
    try {
      const parsed = new URL(uri);
      if (parsed.username || parsed.password || parsed.hash) return false;
    } catch {
      return false;
    }

    return this.allowedRedirectUriPatterns.some((pattern) => {
      const escapedPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${escapedPattern}$`).test(uri);
    });
  }
}
