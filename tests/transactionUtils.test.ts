import { describe, expect, it } from 'vitest';
import {
  buildTransactionUrl,
  formatTransactionAmountsForCSV,
  formatTransactionCurrenciesForCSV,
  formatTransactionDatesForCSV,
  parseCPETransactionAmount,
} from '../src/utils/transactionUtils';

describe('transactionUtils', () => {
  it('builds an encoded Amazon CPE URL', () => {
    expect(buildTransactionUrl('https://www.amazon.de', '123-4567890-1234567')).toBe(
      'https://www.amazon.de/cpe/yourpayments/transactions?transactionTag=123-4567890-1234567'
    );
  });

  it('normalizes charges to positive amounts', () => {
    expect(parseCPETransactionAmount('-12,34 €', 'www.amazon.de')).toEqual({
      amount: 12.34,
      currency: 'EUR',
    });
  });

  it('normalizes refunds to negative amounts', () => {
    expect(parseCPETransactionAmount('12,34 €', 'www.amazon.de')).toEqual({
      amount: -12.34,
      currency: 'EUR',
    });
  });

  it('formats multiple transactions without collapsing equal values', () => {
    const transactions = [
      { date: '2026-09-20', amount: 19.99, currency: 'EUR' },
      { date: '2026-09-20', amount: 19.99, currency: 'EUR' },
    ];
    expect(formatTransactionDatesForCSV(transactions)).toBe('2026-09-20 | 2026-09-20');
    expect(formatTransactionAmountsForCSV(transactions)).toBe('19.99 | 19.99');
    expect(formatTransactionCurrenciesForCSV(transactions)).toBe('EUR | EUR');
  });
});
