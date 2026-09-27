import { describe, it, expect } from 'vitest';
import { escapeCSVValue, formatPromotionsForCSV, convertOrdersToCSV } from '../src/utils/csvUtils';
import type { Order } from '../src/types';

describe('escapeCSVValue', () => {
  it('should return simple values as-is', () => {
    expect(escapeCSVValue('hello')).toBe('hello');
  });

  it('should return numbers as strings', () => {
    expect(escapeCSVValue(123)).toBe('123');
    expect(escapeCSVValue(12.99)).toBe('12.99');
  });

  it('should wrap values with commas in quotes', () => {
    expect(escapeCSVValue('hello, world')).toBe('"hello, world"');
  });

  it('should wrap values with quotes in quotes and escape internal quotes', () => {
    expect(escapeCSVValue('say "hello"')).toBe('"say ""hello"""');
  });

  it('should wrap values with newlines in quotes', () => {
    expect(escapeCSVValue('line1\nline2')).toBe('"line1\nline2"');
  });

  it('should handle undefined and null', () => {
    expect(escapeCSVValue(undefined)).toBe('');
    expect(escapeCSVValue(null as unknown as string)).toBe('');
  });

  it('should handle empty string', () => {
    expect(escapeCSVValue('')).toBe('');
  });

  it('should handle complex strings with multiple special characters', () => {
    expect(escapeCSVValue('Price: €10,99 "special"')).toBe('"Price: €10,99 ""special"""');
  });
});

describe('formatPromotionsForCSV', () => {
  it('should format single promotion', () => {
    const promotions = [{ description: 'Coupon discount', amount: 5.0 }];
    expect(formatPromotionsForCSV(promotions)).toBe('Coupon discount: €5');
  });

  it('should format multiple promotions with semicolon separator', () => {
    const promotions = [
      { description: 'Coupon', amount: 5.0 },
      { description: 'Prime', amount: 3.5 },
    ];
    expect(formatPromotionsForCSV(promotions)).toBe('Coupon: €5; Prime: €3.5');
  });
  it('should format AED promotions with the order currency', () => {
    const promotions = [{ description: 'Coupon', amount: 5.0 }];
    expect(formatPromotionsForCSV(promotions, 'AED')).toBe('Coupon: AED 5');
  });

  it('should default promotion formatting to EUR', () => {
    const promotions = [{ description: 'Coupon', amount: 5.0 }];
    expect(formatPromotionsForCSV(promotions)).toBe('Coupon: €5');
  });

  it('should return empty string for no promotions', () => {
    expect(formatPromotionsForCSV([])).toBe('');
  });
});

describe('convertOrdersToCSV', () => {
  const createOrder = (overrides: Partial<Order> = {}): Order => ({
    orderId: '123-4567890-1234567',
    orderDate: '2024-01-15',
    totalAmount: 99.99,
    currency: 'EUR',
    items: [],
    orderStatus: 'Delivered',
    detailsUrl: 'https://amazon.de/order-details/123',
    promotions: [],
    totalSavings: 0,
    recipientName: '',
    recipientStreet: '',
    recipientCityPostal: '',
    recipientCountry: '',
    ...overrides,
  });
  it('should format promotions using the order currency', () => {
    const orders = [
      createOrder({
        currency: 'AED',
        promotions: [{ description: 'Coupon', amount: 5.0 }],
      }),
    ];
    const csv = convertOrdersToCSV(orders);
    expect(csv).toContain('Coupon: AED 5');
  });

  it('should create CSV with headers', () => {
    const csv = convertOrdersToCSV([]);
    const lines = csv.split('\n');
    expect(lines.length).toBe(1); // Just headers
    expect(lines[0]).toContain('csvHeaderOrderId');
  });

  it('should use custom header function', () => {
    const getHeader = (key: string) => key.replace('csvHeader', '');
    const csv = convertOrdersToCSV([], getHeader);
    expect(csv).toContain('OrderId');
  });

  it('should include order without items as single row', () => {
    const orders = [createOrder()];
    const csv = convertOrdersToCSV(orders);
    const lines = csv.split('\n');
    expect(lines.length).toBe(2); // Header + 1 order
    expect(lines[1]).toContain('123-4567890-1234567');
    expect(lines[1]).toContain('2024-01-15');
  });

  it('should create multiple rows for order with items', () => {
    const orders = [
      createOrder({
        items: [
          {
            title: 'Product 1',
            asin: 'B000000001',
            quantity: 1,
            price: 29.99,
            discount: 0,
            itemUrl: 'https://amazon.de/dp/B000000001',
          },
          {
            title: 'Product 2',
            asin: 'B000000002',
            quantity: 2,
            price: 15.0,
            discount: 0,
            itemUrl: 'https://amazon.de/dp/B000000002',
          },
        ],
      }),
    ];
    const csv = convertOrdersToCSV(orders);
    const lines = csv.split('\n');
    expect(lines.length).toBe(3); // Header + 2 items
    expect(lines[1]).toContain('Product 1');
    expect(lines[2]).toContain('Product 2');
  });

  it('should only include savings on first item row', () => {
    const orders = [
      createOrder({
        totalSavings: 10.0,
        items: [
          {
            title: 'Product 1',
            asin: 'B000000001',
            quantity: 1,
            price: 29.99,
            discount: 0,
            itemUrl: 'https://amazon.de/dp/B000000001',
          },
          {
            title: 'Product 2',
            asin: 'B000000002',
            quantity: 1,
            price: 15.0,
            discount: 0,
            itemUrl: 'https://amazon.de/dp/B000000002',
          },
        ],
      }),
    ];
    const csv = convertOrdersToCSV(orders);
    const lines = csv.split('\n');

    // First item row should have savings
    expect(lines[1]).toMatch(/,10,/);
    // Second item row should have empty savings field
    const headerParts = lines[0]!.split(',');
    const secondRowParts = lines[2]!.split(',');
    const totalSavingsIndex = headerParts.indexOf('csvHeaderTotalSavings');

    expect(totalSavingsIndex).toBeGreaterThanOrEqual(0);
    expect(secondRowParts[totalSavingsIndex]).toBe('');
  });

  it('should escape product titles with special characters', () => {
    const orders = [
      createOrder({
        items: [
          {
            title: 'Product "with quotes", and commas',
            asin: 'B000000001',
            quantity: 1,
            price: 29.99,
            discount: 0,
            itemUrl: 'https://amazon.de/dp/B000000001',
          },
        ],
      }),
    ];
    const csv = convertOrdersToCSV(orders);
    expect(csv).toContain('"Product ""with quotes"", and commas"');
  });

  it('should include recipient fields in headers', () => {
    const csv = convertOrdersToCSV([]);
    expect(csv).toContain('csvHeaderRecipientName');
    expect(csv).toContain('csvHeaderRecipientStreet');
    expect(csv).toContain('csvHeaderRecipientCityPostal');
    expect(csv).toContain('csvHeaderRecipientCountry');
  });

  it('should include recipient values for an order without items', () => {
    const orders = [
      createOrder({
        recipientName: 'Jeremy Ferand',
        recipientStreet: '2, Lieu-dit La Croix des Marais',
        recipientCityPostal: 'Châteaumeillant 18370',
        recipientCountry: 'France',
      }),
    ];
    const csv = convertOrdersToCSV(orders);
    expect(csv).toContain('Jeremy Ferand');
    expect(csv).toContain('"2, Lieu-dit La Croix des Marais"');
    expect(csv).toContain('Châteaumeillant 18370');
    expect(csv).toContain('France');
  });

  it('should only include recipient on the first item row of a multi-item order', () => {
    const orders = [
      createOrder({
        recipientName: 'Jeremy Ferand',
        recipientStreet: '2, Lieu-dit La Croix des Marais',
        recipientCityPostal: 'Châteaumeillant 18370',
        recipientCountry: 'France',
        items: [
          {
            title: 'Product 1',
            asin: 'B000000001',
            quantity: 1,
            price: 29.99,
            discount: 0,
            itemUrl: 'https://amazon.de/dp/B000000001',
          },
          {
            title: 'Product 2',
            asin: 'B000000002',
            quantity: 1,
            price: 15.0,
            discount: 0,
            itemUrl: 'https://amazon.de/dp/B000000002',
          },
        ],
      }),
    ];
    const csv = convertOrdersToCSV(orders);
    const lines = csv.split('\n');

    // First item row should carry the recipient
    expect(lines[1]).toContain('Jeremy Ferand');
    // Second item row should not repeat the recipient: the last 4 columns must
    // be empty, which serializes as four trailing commas at the end of the row.
    // Assert this directly instead of splitting on ',', which is not CSV-safe
    // when earlier columns may contain commas inside quoted fields.
    expect(lines[2]).toMatch(/,{4}$/);
  });
});

describe('Finance enrichment columns', () => {
  it('exports order type, digital metadata and payment transactions', () => {
    const order: Order = {
      orderId: 'D01-1234567-1234567',
      orderDate: '2026-09-20',
      totalAmount: 9.99,
      currency: 'EUR',
      items: [
        {
          title: 'Example Movie',
          asin: '',
          digitalId: 'amzn1.dv.gti.example',
          contentType: 'Prime Video',
          quantity: 1,
          price: 9.99,
          discount: 0,
          itemUrl: 'https://www.amazon.de/gp/video/detail/amzn1.dv.gti.example',
        },
      ],
      orderStatus: '',
      detailsUrl: '',
      promotions: [],
      totalSavings: 0,
      recipientName: '',
      recipientStreet: '',
      recipientCityPostal: '',
      recipientCountry: '',
      orderType: 'digital',
      transactions: [
        { date: '2026-09-21', amount: 9.99, currency: 'EUR' },
        { date: '2026-09-22', amount: -2.0, currency: 'EUR' },
      ],
    };

    const csv = convertOrdersToCSV([order]);
    expect(csv).toContain('csvHeaderOrderType');
    expect(csv).toContain('digital');
    expect(csv).toContain('amzn1.dv.gti.example');
    expect(csv).toContain('Prime Video');
    expect(csv).toContain('2026-09-21 | 2026-09-22');
    expect(csv).toContain('9.99 | -2');
  });
});
