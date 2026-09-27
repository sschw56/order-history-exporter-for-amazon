/**
 * Utilities for Amazon payment transactions (CPE / yourpayments).
 */

import type { Transaction } from '../types';
import { extractPriceFromText } from './priceUtils';

export function buildTransactionUrl(origin: string, orderId: string): string {
  return `${origin}/cpe/yourpayments/transactions?transactionTag=${encodeURIComponent(orderId)}`;
}

export function formatTransactionDatesForCSV(transactions: Transaction[] = []): string {
  return transactions.map((transaction) => transaction.date).join(' | ');
}

export function formatTransactionAmountsForCSV(transactions: Transaction[] = []): string {
  return transactions.map((transaction) => String(transaction.amount)).join(' | ');
}

export function formatTransactionCurrenciesForCSV(transactions: Transaction[] = []): string {
  return transactions.map((transaction) => transaction.currency).join(' | ');
}

export function formatTransactionPaymentMethodsForCSV(transactions: Transaction[] = []): string {
  return transactions.map((transaction) => transaction.paymentMethod || '').join(' | ');
}

export function formatTransactionCardLast4ForCSV(transactions: Transaction[] = []): string {
  return transactions.map((transaction) => transaction.cardLast4 || '').join(' | ');
}

/**
 * Amazon's payment page renders charges with a leading minus sign and credits /
 * refunds without one. For Finance Import we normalize from the account holder's
 * perspective: positive = money paid to Amazon, negative = money returned.
 */
export function parseCPETransactionAmount(
  amountText: string,
  hostname?: string
): { amount: number; currency: string } | null {
  const normalized = amountText.trim();
  const isDebit = /^[-−]/.test(normalized);
  const price = extractPriceFromText(normalized, hostname);
  if (!price || price.amount === 0) return null;

  return {
    amount: isDebit ? price.amount : -price.amount,
    currency: price.currency,
  };
}
