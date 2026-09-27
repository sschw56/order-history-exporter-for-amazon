import { describe, expect, it } from 'vitest';
import {
  extractCardLast4,
  extractPaymentMethod,
  parsePaymentDetailsFromText,
} from '../src/utils/paymentUtils';

describe('paymentUtils', () => {
  it('detects common card brands and PayPal', () => {
    expect(extractPaymentMethod('Visa endet auf 4242')).toBe('Visa');
    expect(extractPaymentMethod('Master Card ending in 1111')).toBe('Mastercard');
    expect(extractPaymentMethod('Payment via PayPal')).toBe('PayPal');
  });

  it('detects German SEPA/direct-debit wording', () => {
    expect(extractPaymentMethod('Zahlungsart: SEPA Lastschrift')).toBe('SEPA/Lastschrift');
    expect(extractPaymentMethod('Zahlung per Bankeinzug')).toBe('SEPA/Lastschrift');
  });

  it('extracts last four card digits from German and masked forms', () => {
    expect(extractCardLast4('Visa endet auf 4242')).toBe('4242');
    expect(extractCardLast4('Mastercard •••• 1111')).toBe('1111');
    expect(extractCardLast4('Visa mit den Endziffern 9876')).toBe('9876');
  });

  it('returns payment method and card suffix together', () => {
    expect(parsePaymentDetailsFromText('Zahlungsart Visa endet auf 4242')).toEqual({
      paymentMethod: 'Visa',
      cardLast4: '4242',
    });
  });

  it('keeps a non-card payment method without inventing card digits', () => {
    expect(parsePaymentDetailsFromText('Bezahlt mit PayPal')).toEqual({
      paymentMethod: 'PayPal',
    });
  });

  it('falls back to a generic card label when only a masked suffix is present', () => {
    expect(parsePaymentDetailsFromText('Zahlungsmittel **** 1234')).toEqual({
      paymentMethod: 'Card',
      cardLast4: '1234',
    });
  });
});
