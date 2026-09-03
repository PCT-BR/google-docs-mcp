import { afterEach, describe, expect, it } from 'vitest';
import { SecureOAuthProxy, parseAdditionalRedirectUriPatterns } from './secureOAuthProxy.js';

const proxies: SecureOAuthProxy[] = [];

function createProxy(): SecureOAuthProxy {
  const proxy = new SecureOAuthProxy({
    upstreamAuthorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    upstreamTokenEndpoint: 'https://oauth2.googleapis.com/token',
    upstreamClientId: 'public-client-id',
    upstreamClientSecret: 'must-never-leak',
    baseUrl: 'https://mcp.example.com',
    scopes: ['openid'],
    allowedRedirectUriPatterns: ['http://127.0.0.1:*'],
    jwtSigningKey: 'test-signing-key',
  });
  proxies.push(proxy);
  return proxy;
}

afterEach(() => {
  for (const proxy of proxies.splice(0)) proxy.destroy();
});

describe('SecureOAuthProxy', () => {
  it('registers a public client without returning the upstream secret', async () => {
    const proxy = createProxy();
    const response = await proxy.registerClient({
      redirect_uris: ['http://127.0.0.1:49152/callback/codex'],
      token_endpoint_auth_method: 'client_secret_basic',
    });

    expect(response.client_id).toBe('public-client-id');
    expect(response.client_secret).toBeUndefined();
    expect(response.client_secret_expires_at).toBeUndefined();
    expect(response.token_endpoint_auth_method).toBe('none');
    expect(JSON.stringify(response)).not.toContain('must-never-leak');
  });

  it('rejects callback hosts that only resemble an allowed loopback address', async () => {
    const proxy = createProxy();

    await expect(
      proxy.registerClient({
        redirect_uris: ['http://127x0x0x1:49152/callback/codex'],
      })
    ).rejects.toThrow('invalid_redirect_uri');
  });

  it('advertises public client authentication', () => {
    const metadata = createProxy().getAuthorizationServerMetadata();
    expect(metadata.tokenEndpointAuthMethodsSupported).toEqual(['none']);
  });

  it('requires S256 PKCE for authorization', async () => {
    const proxy = createProxy();

    await expect(
      proxy.authorize({
        client_id: 'public-client-id',
        redirect_uri: 'http://127.0.0.1:49152/callback/codex',
        response_type: 'code',
      })
    ).rejects.toThrow('invalid_request');
  });

  it('restores an allowed cached client registration after a server restart', async () => {
    const proxy = createProxy();

    const response = await proxy.authorize({
      client_id: 'public-client-id',
      redirect_uri: 'http://127.0.0.1:49152/callback/codex',
      response_type: 'code',
      code_challenge: 'test-challenge',
      code_challenge_method: 'S256',
    });

    expect(response.status).toBe(200);
  });

  it('does not restore a cached client registration outside the allowlist', async () => {
    const proxy = createProxy();

    await expect(
      proxy.authorize({
        client_id: 'public-client-id',
        redirect_uri: 'https://attacker.example/callback',
        response_type: 'code',
        code_challenge: 'test-challenge',
        code_challenge_method: 'S256',
      })
    ).rejects.toThrow('invalid_redirect_uri');
  });
});

describe('parseAdditionalRedirectUriPatterns', () => {
  it('parses explicit comma-separated patterns', () => {
    expect(
      parseAdditionalRedirectUriPatterns(
        'https://librechat.example.com/*, https://chat.example.org/oauth/*'
      )
    ).toEqual(['https://librechat.example.com/*', 'https://chat.example.org/oauth/*']);
  });

  it.each(['https://*', 'http://*', '*'])('rejects an unsafe broad pattern: %s', (pattern) => {
    expect(() => parseAdditionalRedirectUriPatterns(pattern)).toThrow('too broad');
  });
});
