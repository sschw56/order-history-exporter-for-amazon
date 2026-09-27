import { describe, expect, it } from 'vitest';
import { buildFinanceUrl, normalizeFinanceBaseUrl } from '../src/utils/financeUtils';

describe('normalizeFinanceBaseUrl', () => {
  it('normalizes the configured HTTPS base URL', () => {
    expect(normalizeFinanceBaseUrl(' https://finance.swrz-home.de/ ')).toBe(
      'https://finance.swrz-home.de'
    );
  });

  it('rejects insecure non-local URLs', () => {
    expect(() => normalizeFinanceBaseUrl('http://finance.example')).toThrow(/HTTPS/);
  });
});

describe('buildFinanceUrl', () => {
  it('appends API paths without duplicate slashes', () => {
    expect(buildFinanceUrl('https://finance.swrz-home.de/', '/api/health')).toBe(
      'https://finance.swrz-home.de/api/health'
    );
  });
});
