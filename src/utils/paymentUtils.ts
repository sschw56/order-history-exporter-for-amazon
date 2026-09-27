/**
 * Parse payment-method information rendered by Amazon.
 *
 * We intentionally keep only a human-readable payment method and, where Amazon
 * exposes it, the last four card digits. Full payment credentials are never
 * available to the extension and are never stored.
 */

export interface PaymentDetails {
  paymentMethod?: string;
  cardLast4?: string;
}

const PAYMENT_METHOD_PATTERNS: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /\bvisa\b/i, canonical: 'Visa' },
  { pattern: /\bmaster\s*card\b/i, canonical: 'Mastercard' },
  { pattern: /\bamerican\s+express\b|\bamex\b/i, canonical: 'American Express' },
  { pattern: /\bmaestro\b/i, canonical: 'Maestro' },
  { pattern: /\bdiscover\b/i, canonical: 'Discover' },
  { pattern: /\bdiners\s*club\b/i, canonical: 'Diners Club' },
  { pattern: /\bjcb\b/i, canonical: 'JCB' },
  { pattern: /\bunionpay\b/i, canonical: 'UnionPay' },
  { pattern: /\bpaypal\b/i, canonical: 'PayPal' },
  {
    pattern: /\bsepa\b|\blastschrift\b|\bbankeinzug\b|\bdirect\s+debit\b/i,
    canonical: 'SEPA/Lastschrift',
  },
  {
    pattern: /geschenkgutschein|gift\s*card|gutschein(?:guthaben)?/i,
    canonical: 'Amazon-Geschenkgutschein',
  },
];

const LAST4_PATTERNS = [
  /(?:ending\s+(?:in|with)|ends?\s+with|ending)\s+(?:in\s+)?(\d{4})\b/i,
  /endet\s+auf\s+(\d{4})\b/i,
  /(?:endziffern|letzten\s+4\s+ziffern)\D{0,12}(\d{4})\b/i,
  /se\s+terminant\s+par\s+(\d{4})\b/i,
  /(?:que\s+termina|termina|terminada)\s+en\s+(\d{4})\b/i,
  /(?:\*{2,}|•{2,}|x{2,})\s*[-\s]?\s*(\d{4})\b/i,
];

export function extractPaymentMethod(text: string): string | undefined {
  for (const { pattern, canonical } of PAYMENT_METHOD_PATTERNS) {
    if (pattern.test(text)) return canonical;
  }
  return undefined;
}

export function extractCardLast4(text: string): string | undefined {
  for (const pattern of LAST4_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export function parsePaymentDetailsFromText(text: string): PaymentDetails {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return {};

  const paymentMethod = extractPaymentMethod(compact);
  const cardLast4 = extractCardLast4(compact);

  if (!paymentMethod && cardLast4) {
    return { paymentMethod: 'Card', cardLast4 };
  }

  return {
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(cardLast4 ? { cardLast4 } : {}),
  };
}

/**
 * Fallback parser for order-detail pages. Transaction-page parsing remains the
 * preferred source because it can associate a payment method with each charge.
 */
export function parsePaymentDetailsFromDocument(doc: Document): PaymentDetails {
  const candidateSelectors = [
    '#payment-information',
    '#paymentInformation',
    '[data-component="paymentMethod"]',
    '[class*="payment-method"]',
    '[class*="pmts-payment-instrument"]',
    '.pmts-payment-instrument-detail-box',
    '.a-box.payment-box',
    '#od-subtotals',
  ];

  for (const selector of candidateSelectors) {
    for (const element of Array.from(doc.querySelectorAll(selector))) {
      const parsed = parsePaymentDetailsFromText(element.textContent || '');
      if (parsed.paymentMethod || parsed.cardLast4) return parsed;
    }
  }

  return parsePaymentDetailsFromText(doc.body?.textContent || '');
}
