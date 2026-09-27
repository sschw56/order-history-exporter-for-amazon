/**
 * URL building and Amazon page detection utilities
 */

const AMAZON_LOCALE_PREFIX = /^\/-\/[a-z]{2}(?:[-_][a-z]{2})?(?=\/)/i;

/**
 * Build URL for a specific year and page of Amazon order history
 */
export function buildOrderPageUrl(baseUrl: string, year: string, startIndex: number = 0): string {
  try {
    const urlObj = new URL(baseUrl);
    urlObj.searchParams.set('timeFilter', `year-${year}`);
    if (startIndex > 0) {
      urlObj.searchParams.set('startIndex', startIndex.toString());
    } else {
      urlObj.searchParams.delete('startIndex');
    }
    return urlObj.toString();
  } catch {
    const params = new URLSearchParams();
    params.set('timeFilter', `year-${year}`);
    if (startIndex > 0) {
      params.set('startIndex', startIndex.toString());
    }
    return `${baseUrl}?${params.toString()}`;
  }
}

/**
 * List of supported Amazon domains
 */
export const AMAZON_DOMAINS = [
  'amazon.com',
  'amazon.co.uk',
  'amazon.se',
  'amazon.de',
  'amazon.fr',
  'amazon.it',
  'amazon.es',
  'amazon.ca',
  'amazon.co.jp',
  'amazon.in',
  'amazon.com.au',
  'amazon.com.br',
  'amazon.com.mx',
  'amazon.com.be',
  'amazon.ae',
];

/**
 * Order history page paths
 */
export const ORDER_PATHS = [
  '/gp/your-account/order-history',
  '/gp/css/order-history',
  '/your-orders/orders',
  '/your-orders',
];

function isAmazonDomainHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return AMAZON_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  );
}

function getAmazonLocalePrefix(pathname: string): string {
  return pathname.match(AMAZON_LOCALE_PREFIX)?.[0] || '';
}

function normalizeAmazonPath(pathname: string): string {
  const localePrefix = getAmazonLocalePrefix(pathname);
  return localePrefix ? pathname.slice(localePrefix.length) || '/' : pathname;
}

function getMatchedOrderPath(pathname: string): string | null {
  const normalizedPath = normalizeAmazonPath(pathname);
  const matchedPath = [...ORDER_PATHS]
    .sort((a, b) => b.length - a.length)
    .find((path) => normalizedPath.startsWith(path));
  return matchedPath || null;
}

/**
 * Check if a URL is an Amazon order history page
 */
export function isAmazonOrderHistoryPage(url: string): boolean {
  if (!url) return false;

  try {
    const urlObj = new URL(url);
    return isAmazonDomainHost(urlObj.hostname) && getMatchedOrderPath(urlObj.pathname) !== null;
  } catch {
    return false;
  }
}

/**
 * Extract base order history URL from current page URL
 */
export function getOrderHistoryBaseUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const localePrefix = getAmazonLocalePrefix(urlObj.pathname);
    const matchedPath = getMatchedOrderPath(urlObj.pathname);

    const preferredPath = matchedPath
      ? matchedPath === '/your-orders'
        ? '/your-orders/orders'
        : matchedPath
      : '/your-orders/orders';

    const base = new URL(`${urlObj.origin}${localePrefix}${preferredPath}`);
    const orderFilter = urlObj.searchParams.get('orderFilter');
    if (orderFilter) {
      base.searchParams.set('orderFilter', orderFilter);
    }
    return base.toString();
  } catch {
    return '';
  }
}

/**
 * Extract ASIN from a product URL
 */
export function extractAsinFromUrl(url: string): string | null {
  const asinMatch = url.match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  return asinMatch?.[1]?.toUpperCase() || null;
}

/** Check whether the current order-history tab is Amazon Digital Orders. */
export function isDigitalOrderPage(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return (
      isAmazonDomainHost(urlObj.hostname) &&
      getMatchedOrderPath(urlObj.pathname) !== null &&
      urlObj.searchParams.get('orderFilter') === 'digital'
    );
  } catch {
    return false;
  }
}

/** Check whether a details URL points to Amazon's digital-order details view. */
export function isDigitalOrderDetailsUrl(url: string): boolean {
  return (
    /(?:digi_order_details|\/gp\/css\/order-details)/i.test(url) && /orderI[Dd]=D\d{2}-/i.test(url)
  );
}

/** Extract a stable digital-content identifier from common Amazon URLs. */
export function extractDigitalIdFromUrl(url: string): string | null {
  const videoMatch = url.match(/\/gp\/video\/detail\/(amzn1\.[^?/#]+)/i);
  if (videoMatch?.[1]) return videoMatch[1];

  const audibleMatch = url.match(/\/pd\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  if (audibleMatch?.[1]) return audibleMatch[1].toUpperCase();

  return null;
}
