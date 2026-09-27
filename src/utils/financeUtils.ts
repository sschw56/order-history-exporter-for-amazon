/** Helpers for the optional Finance Import integration. */

export const DEFAULT_FINANCE_IMPORT_URL = 'https://finance.swrz-home.de';
export const FINANCE_API_PATH = '/api/amazon/orders';
export const FINANCE_HEALTH_PATH = '/api/health';

export function normalizeFinanceBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Finance Import URL is missing');
  }

  const url = new URL(trimmed);
  const isLocalHttp =
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('Finance Import URL must use HTTPS');
  }

  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');

  return url.toString().replace(/\/+$/, '');
}

export function buildFinanceUrl(baseUrl: string, path: string): string {
  const base = normalizeFinanceBaseUrl(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
