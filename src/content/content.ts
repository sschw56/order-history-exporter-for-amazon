/**
 * Order History Exporter for Amazon - Content Script
 * Scrapes order data from Amazon order history pages using browser navigation
 */

import browser from 'webextension-polyfill';
import type {
  ExportOptions,
  ExportState,
  Order,
  OrderItem,
  Promotion,
  Transaction,
} from '../types';
import {
  parseOrderDate,
  extractOrderYear,
  filterYearsByDateRange,
  buildOrderPageUrl,
  getOrderHistoryBaseUrl,
  extractAsinFromUrl,
  extractDigitalIdFromUrl,
  isDigitalOrderPage,
  isDigitalOrderDetailsUrl,
  isDigitalOrderId,
  isAdvertisementOrder,
  convertOrdersToCSV,
  extractOrderId,
  extractOrderIdFromUrl,
  extractPriceFromText,
  parsePrice,
  CURRENCY_TOKEN,
  getCurrencyForDomain,
  parseOrderStatus,
  buildTransactionUrl,
  parseCPETransactionAmount,
  parsePaymentDetailsFromText,
  parsePaymentDetailsFromDocument,
} from '../utils';
import { STORAGE_KEY, STOP_FLAG_KEY } from '../constants';

(function (): void {
  'use strict';

  /**
   * In-memory stop flag for the current page load.
   *
   * Because the content script is reloaded on every page navigation, this flag
   * only survives within a single page.  For cross-navigation stop requests
   * (i.e. the user clicks "Stop" while the content script is between pages) we
   * also persist the flag to `browser.storage.session` under STOP_FLAG_KEY.
   * `checkExportState` reads that persisted flag on the next page load, so the
   * stop takes effect even when the direct message is lost.
   */
  let stopRequested = false;

  /**
   * Get localized message from browser i18n API
   */
  function getMessage(key: string, substitutions?: string | string[]): string {
    return browser.i18n.getMessage(key, substitutions) || key;
  }

  // Check if we're in the middle of an export operation
  checkExportState();

  // Listen for messages from popup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  browser.runtime.onMessage.addListener((message: any, _sender: any) => {
    const msg = message as { action: string; options?: ExportOptions };

    if (msg.action === 'exportOrders' && msg.options) {
      startExport(msg.options);
      return Promise.resolve({ success: true, message: 'Export started' });
    }
    if (msg.action === 'getExportStatus') {
      const state = getExportState();
      return Promise.resolve(state ? { success: true, ...state } : { success: false });
    }
    if (msg.action === 'stopExport') {
      stopRequested = true;
      clearExportState();
      // Notify popup via dedicated action so it doesn't rely on string comparison
      browser.runtime.sendMessage({ action: 'exportStopped' }).catch(() => {
        // Popup may not be open — not an error condition
        console.debug('[Amazon Exporter] Popup not reachable for exportStopped notification');
      });
      return Promise.resolve({ success: true });
    }

    return undefined;
  });

  /**
   * Get export state from sessionStorage
   */
  function getExportState(): ExportState | null {
    try {
      const data = sessionStorage.getItem(STORAGE_KEY);
      return data ? (JSON.parse(data) as ExportState) : null;
    } catch {
      return null;
    }
  }

  /**
   * Save export state to sessionStorage
   */
  function saveExportState(state: ExportState): void {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  /**
   * Clear export state
   */
  function clearExportState(): void {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Check if we should continue an export after page navigation
   */
  function checkExportState(): void {
    const run = (): void => {
      setTimeout(async () => {
        // Check if stop was requested while the content script was unloaded.
        // Wrap in try-catch: if storage.session is unavailable (missing
        // permission / unsupported browser), we still want the resume logic
        // below to execute.
        try {
          const stopFlag = await browser.storage.session.get(STOP_FLAG_KEY);
          if (stopFlag[STOP_FLAG_KEY]) {
            await browser.storage.session.remove(STOP_FLAG_KEY);
            clearExportState();
            return;
          }
        } catch {
          console.debug('[Amazon Exporter] Could not read stop flag from storage.session');
        }

        const state = getExportState();
        if (state && state.inProgress) {
          console.log('[Amazon Exporter]', getMessage('resumingExport'), state);
          continueExport(state);
        }
      }, 1500);
    };

    // Wait for page to be fully loaded, then add delay for Amazon's JS to render
    if (document.readyState === 'complete') {
      run();
    } else {
      window.addEventListener('load', run, { once: true });
    }
  }

  /**
   * Start a new export
   */
  function startExport(options: ExportOptions): void {
    // Reset stop flag for fresh export
    stopRequested = false;

    const { format, startDate, endDate, exportAll } = options;

    // Get available years
    const years = getAvailableYears();
    console.log('[Amazon Exporter] Found years:', years);

    // Filter years based on date range
    const yearsToProcess = exportAll
      ? [...years]
      : filterYearsByDateRange(years, startDate, endDate);

    console.log('[Amazon Exporter] Years to process:', yearsToProcess);

    if (yearsToProcess.length === 0) {
      alert(getMessage('noYearsFound'));
      return;
    }

    // Initialize export state
    const state: ExportState = {
      inProgress: true,
      format: format,
      startDate: startDate,
      endDate: endDate,
      exportAll: exportAll,
      yearsToProcess: yearsToProcess,
      currentYearIndex: 0,
      currentStartIndex: 0,
      collectedOrders: [],
      seenOrderIds: [],
      baseUrl: getOrderHistoryBaseUrl(window.location.href),
    };

    saveExportState(state);

    const firstYear = yearsToProcess[0];
    if (!firstYear) return;

    // Navigate to first year's first page
    const firstUrl = buildOrderPageUrl(state.baseUrl, firstYear, 0);
    console.log('[Amazon Exporter] Starting export, navigating to:', firstUrl);

    // If we're already on the right page, scrape directly
    if (
      window.location.href.includes(`timeFilter=year-${firstYear}`) &&
      !window.location.href.includes('startIndex')
    ) {
      scrapeCurrentPageAndContinue(state);
    } else {
      window.location.href = firstUrl;
    }
  }

  /**
   * Continue an export after page navigation
   */
  function continueExport(state: ExportState): void {
    // Check if stop was requested while away (e.g. between page navigations)
    if (stopRequested || !getExportState()) {
      return;
    }

    const currentYear = state.yearsToProcess[state.currentYearIndex];
    const pageNum = String(Math.floor(state.currentStartIndex / 10) + 1);
    updateProgress(
      calculateProgress(state),
      getMessage('processingYear', [currentYear || '', pageNum])
    );

    scrapeCurrentPageAndContinue(state);
  }

  /**
   * Scrape the current page and decide what to do next
   */
  function scrapeCurrentPageAndContinue(state: ExportState): void {
    // Check if stop was requested mid-export
    if (stopRequested || !getExportState()) {
      return;
    }

    const startDateObj = state.startDate ? new Date(state.startDate) : null;
    const endDateObj = state.endDate ? new Date(state.endDate) : null;

    // Scrape orders from current page
    const pageOrders = scrapeVisibleOrders(
      startDateObj,
      endDateObj,
      state.exportAll,
      new Set(state.seenOrderIds)
    );

    console.log('[Amazon Exporter] Found', pageOrders.length, 'orders on this page');

    // Add to collected orders (avoiding duplicates)
    pageOrders.forEach((order) => {
      if (!state.seenOrderIds.includes(order.orderId)) {
        state.collectedOrders.push(order);
        state.seenOrderIds.push(order.orderId);
      }
    });

    // Check if there are more pages for current year
    const hasNextPage = checkForNextPage();

    if (hasNextPage && pageOrders.length > 0) {
      // Navigate to next page of current year
      state.currentStartIndex += 10;
      saveExportState(state);

      const currentYear = state.yearsToProcess[state.currentYearIndex];
      if (!currentYear) return;

      const nextUrl = buildOrderPageUrl(state.baseUrl, currentYear, state.currentStartIndex);
      console.log('[Amazon Exporter] Navigating to next page:', nextUrl);
      window.location.href = nextUrl;
      return;
    }

    // Move to next year
    state.currentYearIndex++;
    state.currentStartIndex = 0;

    if (state.currentYearIndex < state.yearsToProcess.length) {
      // Navigate to first page of next year
      saveExportState(state);

      const nextYear = state.yearsToProcess[state.currentYearIndex];
      if (!nextYear) return;

      const nextUrl = buildOrderPageUrl(state.baseUrl, nextYear, 0);
      console.log('[Amazon Exporter] Navigating to next year:', nextUrl);
      window.location.href = nextUrl;
      return;
    }

    // All done - finish export
    finishExport(state);
  }

  /**
   * Finish the export and download the file
   */
  async function finishExport(state: ExportState): Promise<void> {
    console.log('[Amazon Exporter] Export complete. Total orders:', state.collectedOrders.length);

    updateProgress(80, getMessage('fetchingPrices', [String(state.collectedOrders.length)]));

    // Fetch item prices for multi-item orders
    await fetchOrderDetailsForPrices(state.collectedOrders);

    // Check if stop was requested during price fetching (state already cleared by handler)
    if (stopRequested || !getExportState()) {
      return;
    }

    updateProgress(95, getMessage('generatingFile'));

    // Generate file
    let fileContent: string;
    let fileName: string;
    let mimeType: string;
    const timestamp = new Date().toISOString().split('T')[0];

    if (state.format === 'json') {
      fileContent = JSON.stringify(state.collectedOrders, null, 2);
      fileName = `amazon-orders-${timestamp}.json`;
      mimeType = 'application/json';
    } else {
      fileContent = convertToCSV(state.collectedOrders);
      fileName = `amazon-orders-${timestamp}.csv`;
      mimeType = 'text/csv';
    }

    // Download via background script
    await browser.runtime.sendMessage({
      action: 'downloadFile',
      data: {
        content: fileContent,
        fileName: fileName,
        mimeType: mimeType,
      },
    });

    updateProgress(100, getMessage('exportComplete', [String(state.collectedOrders.length)]));

    // Clear state
    clearExportState();
  }

  /**
   * Calculate progress percentage
   */
  function calculateProgress(state: ExportState): number {
    const yearProgress = state.currentYearIndex / state.yearsToProcess.length;
    const pageProgress = Math.min(state.currentStartIndex / 100, 0.9);
    return Math.floor((yearProgress + pageProgress / state.yearsToProcess.length) * 75) + 5;
  }

  /**
   * Get available years from the order filter dropdown
   */
  function getAvailableYears(): string[] {
    const years: string[] = [];

    // Try different selectors for the year/time filter
    const selectors = [
      '#time-filter',
      '#orderFilter',
      'select[name="timeFilter"]',
      'select[name="orderFilter"]',
      '[data-action="a-dropdown-button"]',
      '.a-dropdown-container select',
      '#a-autoid-1-announce',
      '[id*="dropdown"] select',
      'form select',
    ];

    for (const selector of selectors) {
      const dropdown = document.querySelector(selector);
      if (dropdown) {
        const options = dropdown.querySelectorAll('option');
        options.forEach((option) => {
          const value = option.value || option.textContent || '';
          const year = extractOrderYear(value);
          if (year) {
            years.push(year);
          }
        });
        if (years.length > 0) break;
      }
    }

    // Check for year links
    const yearLinks = document.querySelectorAll('a[href*="timeFilter=year-"]');
    yearLinks.forEach((link) => {
      const href = (link as HTMLAnchorElement).href;
      const year = extractOrderYear(href);
      if (year && !years.includes(year)) {
        years.push(year);
      }
    });

    // Check dropdown items in Amazon's custom dropdown
    const dropdownItems = document.querySelectorAll(
      '[data-value*="year-"], .a-popover-inner li, #orderFilter option'
    );
    dropdownItems.forEach((item) => {
      const value =
        item.getAttribute('data-value') ||
        (item as HTMLOptionElement).value ||
        item.textContent ||
        '';
      const year = extractOrderYear(value);
      if (year && !years.includes(year)) {
        years.push(year);
      }
    });

    // If no years found, generate recent years
    if (years.length === 0) {
      const currentYear = new Date().getFullYear();
      for (let y = currentYear; y >= currentYear - 10; y--) {
        years.push(y.toString());
      }
    }

    return [...new Set(years)].sort((a, b) => Number(b) - Number(a));
  }

  /**
   * Check if there's a next page
   */
  function checkForNextPage(): boolean {
    const nextSelectors = [
      '.a-pagination .a-last:not(.a-disabled) a',
      'a[aria-label*="Nächste"]',
      'a[aria-label*="Nästa"]',
      'a[aria-label*="Next"]',
      'a[aria-label*="Siguiente"]',
      '.a-pagination li:last-child:not(.a-disabled) a',
      'a.a-last:not(.a-disabled)',
    ];

    for (const selector of nextSelectors) {
      const nextBtn = document.querySelector(selector);
      if (nextBtn) {
        console.log('[Amazon Exporter] Next page button found');
        return true;
      }
    }

    return false;
  }

  /**
   * Scrape orders from the currently visible page
   */
  function scrapeVisibleOrders(
    startDateObj: Date | null,
    endDateObj: Date | null,
    exportAll: boolean,
    seenOrderIds: Set<string>
  ): Order[] {
    const orders: Order[] = [];

    console.log('[Amazon Exporter] Scraping visible page...');
    console.log('[Amazon Exporter] URL:', window.location.href);

    // Try multiple selectors for order cards
    const orderSelectors = [
      '.order-card',
      '.order',
      '[data-component="orderCard"]',
      '.a-box-group.order',
      '.your-orders-content-container .a-box-group',
      '#ordersContainer .order-card',
      '.js-order-card',
      '[class*="order-card"]',
    ];

    let orderElements: NodeListOf<Element> | Element[] =
      document.querySelectorAll('.__nonexistent__');
    for (const selector of orderSelectors) {
      orderElements = document.querySelectorAll(selector);
      if (orderElements.length > 0) {
        console.log(
          `[Amazon Exporter] Found ${orderElements.length} orders with selector: ${selector}`
        );
        break;
      }
    }

    // Fallback: find elements containing order IDs
    if (orderElements.length === 0) {
      const orderIdPattern = /(?:D\d{2}-|\d{3}-)\d{7}-\d{7}/i;
      const potentialOrders = new Set<Element>();

      document.querySelectorAll('*').forEach((el) => {
        if (el.textContent && orderIdPattern.test(el.textContent)) {
          let parent: Element | null = el;
          for (let i = 0; i < 10 && parent?.parentElement; i++) {
            parent = parent.parentElement;
            if (
              parent.classList.contains('a-box') ||
              parent.classList.contains('a-box-group') ||
              (parent.tagName === 'DIV' && parent.children.length > 3)
            ) {
              potentialOrders.add(parent);
              break;
            }
          }
        }
      });

      orderElements = Array.from(potentialOrders);
      console.log(`[Amazon Exporter] Fallback found ${orderElements.length} order containers`);
    }

    orderElements.forEach((orderEl, index) => {
      try {
        const order = parseOrderElement(orderEl);
        if (order && order.orderId) {
          // Skip duplicates
          if (seenOrderIds.has(order.orderId)) {
            return;
          }

          // Filter by date if specified
          if (!exportAll && startDateObj && endDateObj && order.orderDate) {
            const orderDateObj = new Date(order.orderDate);
            if (orderDateObj < startDateObj || orderDateObj > endDateObj) {
              return;
            }
          }

          orders.push(order);
          console.log(
            `[Amazon Exporter] Parsed order: ${order.orderId}, ${order.orderDate}, ${order.totalAmount} ${order.currency}`
          );
        }
      } catch (error) {
        console.warn(`[Amazon Exporter] Failed to parse order ${index}:`, error);
      }
    });

    return orders;
  }

  /**
   * Read an order card's text without injected <script>/<style> source to avoid polluting the regexes.
   */
  function getOrderCardText(orderEl: Element): string {
    const clone = orderEl.cloneNode(true) as Element;
    clone.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
    return clone.textContent || '';
  }

  /**
   * Parse a single order element
   */
  function parseOrderElement(orderEl: Element): Order | null {
    const order: Order = {
      orderId: '',
      orderDate: '',
      totalAmount: 0,
      currency: getCurrencyForDomain(window.location.hostname) ?? 'EUR',
      items: [],
      orderStatus: '',
      detailsUrl: '',
      promotions: [],
      totalSavings: 0,
      recipientName: '',
      recipientStreet: '',
      recipientCityPostal: '',
      recipientCountry: '',
      orderType: isDigitalOrderPage(window.location.href) ? 'digital' : 'physical',
      transactions: [],
    };

    const orderText = getOrderCardText(orderEl);

    // Extract Order ID
    order.orderId = extractOrderId(orderText) || '';

    // Try links for order ID
    if (!order.orderId) {
      const links = orderEl.querySelectorAll('a[href]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const orderId = extractOrderIdFromUrl(href);
        if (orderId) {
          order.orderId = orderId;
          break;
        }
      }
    }

    // Extract order details URL
    const detailsLink = orderEl.querySelector(
      'a[href*="order-details"], a[href*="orderID="], a[href*="orderId="]'
    ) as HTMLAnchorElement | null;
    if (detailsLink) {
      order.detailsUrl = detailsLink.href;
      if (!order.orderId) {
        order.orderId = extractOrderIdFromUrl(order.detailsUrl) || '';
      }
    }

    // Digital orders can appear inside the regular order-history view. Detect
    // them per order instead of relying only on the current page filter.
    if (
      isDigitalOrderPage(window.location.href) ||
      isDigitalOrderId(order.orderId) ||
      isDigitalOrderDetailsUrl(order.detailsUrl)
    ) {
      order.orderType = 'digital';
    }

    // Extract order dates from supported locales
    order.orderDate = parseOrderDate(orderText);

    // Extract Total Amount (pass hostname for domain-aware currency detection)
    const priceResult = extractPriceFromText(orderText, window.location.hostname);
    if (priceResult) {
      order.totalAmount = priceResult.amount;
      order.currency = priceResult.currency;
    }

    // Digital orders do not have a shipment status or shipping recipient.
    if (order.orderType === 'digital') {
      order.orderStatus = '';
      order.items = parseDigitalOrderItems(orderEl);
    } else {
      order.orderStatus = parseOrderStatus(orderText);
      order.items = parseOrderItems(orderEl);

      const recipient = parseRecipient(orderEl);
      order.recipientName = recipient.name;
      order.recipientStreet = recipient.street;
      order.recipientCityPostal = recipient.cityPostal;
      order.recipientCountry = recipient.country;
    }

    // Filter out advertisement/fake orders
    // These typically have no date, no status, no details URL, and contain ads like "Amazon Visa"
    if (isAdvertisementOrder(order)) {
      console.log('[Amazon Exporter] Skipping advertisement order:', order.orderId);
      return null;
    }

    return order;
  }

  /**
   * Parse the recipient (name + shipping address) from an order element.
   *
   * Amazon embeds the shipping address inside `.yohtmlc-recipient`:
   *  - The recipient name is inside `<a class="...insert-encrypted-trigger-text">`
   *  - The full address is preloaded inside `.a-popover-preload`, as three `.a-row`s:
   *      1. <h5>Name</h5>
   *      2. Street lines + city/postal, separated by <br>
   *      3. Country
   *
   * Returns empty strings for any field that cannot be located.
   */
  function parseRecipient(orderEl: Element): {
    name: string;
    street: string;
    cityPostal: string;
    country: string;
  } {
    const result = { name: '', street: '', cityPostal: '', country: '' };

    const recipientEl = orderEl.querySelector('.yohtmlc-recipient');
    if (!recipientEl) return result;

    // Name: the trigger text inside the popover anchor
    const triggerEl = recipientEl.querySelector(
      'a.a-popover-trigger, .insert-encrypted-trigger-text'
    );
    if (triggerEl) {
      // textContent includes the trailing icon span; .trim() handles whitespace,
      // and the icon has no text so it doesn't pollute the result.
      result.name = (triggerEl.textContent || '').trim();
    }

    // Full address: from the preloaded popover content
    const preloadEl = recipientEl.querySelector('.a-popover-preload');
    if (!preloadEl) return result;

    const rows = preloadEl.querySelectorAll('.a-row');
    if (rows.length === 0) return result;

    // Fallback for name from the h5 inside the popover
    if (!result.name) {
      const h5 = preloadEl.querySelector('h5');
      if (h5) result.name = (h5.textContent || '').trim();
    }

    // Walk through rows; skip the name row (the one containing an h5).
    const addressRows: Element[] = [];
    rows.forEach((row) => {
      if (!row.querySelector('h5')) addressRows.push(row);
    });

    if (addressRows.length === 0) return result;

    // Last address row = country. Everything before = street lines + city/postal.
    const countryEl = addressRows[addressRows.length - 1];
    if (countryEl) {
      result.country = (countryEl.textContent || '').trim();
    }

    const streetRows = addressRows.slice(0, -1);

    // Each row may contain multiple lines separated by <br>. Replace <br> with \n,
    // strip remaining HTML, split into lines.
    const allLines: string[] = [];
    streetRows.forEach((row) => {
      const html = row.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
      const decoded = decodeHtmlEntities(html);
      decoded
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => allLines.push(line));
    });

    if (allLines.length === 0) return result;

    // Heuristic: the last line of the address block is the city + postal code
    // (e.g. "Châteaumeillant 18370" or "Paris 75009"). Everything above is the
    // street (possibly multi-line: "27, Rue X" + "Apt B" + ...).
    result.cityPostal = allLines[allLines.length - 1] ?? '';
    result.street = allLines.slice(0, -1).join(', ');

    return result;
  }

  // Reused across decodeHtmlEntities calls to avoid allocating a fresh <textarea>
  // per address row when parsing many orders.
  let entityDecoderTextarea: HTMLTextAreaElement | null = null;

  /**
   * Lightweight HTML entity decoder for the small subset Amazon uses in addresses
   * (we run inside a content script, so we can leverage the textarea trick).
   */
  function decodeHtmlEntities(text: string): string {
    if (!entityDecoderTextarea) {
      entityDecoderTextarea = document.createElement('textarea');
    }
    entityDecoderTextarea.innerHTML = text;
    return entityDecoderTextarea.value;
  }

  /**
   * Parse items from an order element
   */
  function parseOrderItems(orderEl: Element): OrderItem[] {
    const items: OrderItem[] = [];
    const seenAsins = new Set<string>();

    // Find all product links
    const productLinks = orderEl.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]');

    productLinks.forEach((link) => {
      const href = link.getAttribute('href') || (link as HTMLAnchorElement).href || '';
      const asin = extractAsinFromUrl(href);
      if (!asin) return;

      if (seenAsins.has(asin)) return;
      seenAsins.add(asin);

      const item: OrderItem = {
        title: '',
        asin: asin,
        quantity: 1,
        price: 0,
        discount: 0,
        // Derive from the marketplace being scraped - hardcoding amazon.de
        // produced wrong links for every other marketplace
        itemUrl: `${window.location.origin}/dp/${asin}`,
      };

      // Get title
      let title = link.textContent?.trim() || '';

      if (!title || title.length < 5) {
        let parent = link.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          const titleEl = parent.querySelector(
            '.a-text-bold, [class*="product-title"], [class*="item-title"]'
          );
          if (
            titleEl &&
            titleEl.textContent?.trim().length &&
            titleEl.textContent.trim().length > 5
          ) {
            title = titleEl.textContent.trim();
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (!title || title.length < 5) {
        title = (link as HTMLAnchorElement).title || link.getAttribute('aria-label') || '';
      }

      if (!title || title.length < 5) {
        const img = link.querySelector('img') || link.parentElement?.querySelector('img');
        if (img?.alt) title = img.alt;
      }

      item.title = title.replace(/\s+/g, ' ').trim();

      // Get quantity - first look for the visual quantity badge
      let foundQuantity = false;
      let parentEl = link.parentElement;

      // Look for the quantity badge element (product-image__qty)
      for (let i = 0; i < 10 && parentEl && !foundQuantity; i++) {
        const qtyBadge = parentEl.querySelector(
          '.product-image__qty, [class*="qty-badge"], [class*="quantity-badge"]'
        );
        if (qtyBadge) {
          const qtyText = qtyBadge.textContent?.trim();
          if (qtyText) {
            const qty = parseInt(qtyText, 10);
            if (!isNaN(qty) && qty > 0) {
              item.quantity = qty;
              foundQuantity = true;
              break;
            }
          }
        }
        parentEl = parentEl.parentElement;
      }

      // Fallback: look for text patterns like "Qty: 2", "Menge: 2"
      if (!foundQuantity) {
        parentEl = link.parentElement;
        for (let i = 0; i < 8 && parentEl; i++) {
          const qtyMatch = (parentEl.textContent || '').match(
            /(?:Qty|Quantity|Menge|Anzahl|Antal|Cantidad|Cant\.?)[:\s]*(\d+)/i
          );
          if (qtyMatch?.[1]) {
            item.quantity = parseInt(qtyMatch[1], 10);
            break;
          }
          parentEl = parentEl.parentElement;
        }
      }

      if (item.title || item.asin) {
        items.push(item);
      }
    });

    return items;
  }

  /**
   * Parse products from Amazon's Digital Orders tab (Prime Video, Kindle, Audible, ...).
   * This deliberately keeps the model close to normal order items so Finance Import
   * can consume both kinds of orders through the same JSON structure.
   */
  function parseDigitalOrderItems(orderEl: Element): OrderItem[] {
    const items: OrderItem[] = [];
    const seenIds = new Set<string>();
    const links = Array.from(orderEl.querySelectorAll('a[href]')) as HTMLAnchorElement[];

    for (const link of links) {
      const href = link.href || '';
      const title = link.textContent?.replace(/\s+/g, ' ').trim() || '';
      const asin = extractAsinFromUrl(href) || '';
      const digitalId = extractDigitalIdFromUrl(href) || '';
      const uniqueId = digitalId || asin;

      if (!uniqueId || seenIds.has(uniqueId)) continue;
      if (title.length < 2) continue;

      const looksDigital =
        href.includes('/gp/video/detail/') ||
        href.includes('/dp/') ||
        href.includes('/gp/product/') ||
        href.includes('/product/') ||
        href.includes('/pd/');
      if (!looksDigital) continue;

      seenIds.add(uniqueId);
      const contentType =
        orderEl.querySelector('.a-size-small.a-text-bold')?.textContent?.trim() || '';

      items.push({
        title,
        asin,
        digitalId: digitalId || undefined,
        quantity: 1,
        price: 0,
        discount: 0,
        itemUrl: href,
        contentType: contentType || undefined,
      });
    }

    if (items.length === 0) {
      const imageTitle = orderEl.querySelector('img')?.getAttribute('alt')?.trim() || '';
      if (imageTitle) {
        items.push({
          title: imageTitle,
          asin: '',
          quantity: 1,
          price: 0,
          discount: 0,
          itemUrl: '',
          contentType:
            orderEl.querySelector('.a-size-small.a-text-bold')?.textContent?.trim() || undefined,
        });
      }
    }

    return items;
  }

  /**
   * Fetch order details for item prices and discounts and enrich each order with
   * the actual Amazon payment transactions from /cpe/yourpayments/transactions.
   */
  async function fetchOrderDetailsForPrices(orders: Order[]): Promise<void> {
    console.log('[Amazon Exporter] Enriching', orders.length, 'orders');

    for (let i = 0; i < orders.length; i++) {
      if (stopRequested || !getExportState()) break;

      const order = orders[i];
      if (!order) continue;

      let fallbackPaymentDetails: { paymentMethod?: string; cardLast4?: string } = {};

      try {
        updateProgress(
          80 + (i / Math.max(orders.length, 1)) * 10,
          getMessage('fetchingPricesProgress', [String(i + 1), String(orders.length)])
        );

        if (order.detailsUrl) {
          const response = await fetch(order.detailsUrl, { credentials: 'include' });
          if (response.ok) {
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            fallbackPaymentDetails = parsePaymentDetailsFromDocument(doc);

            if (order.orderType === 'digital') {
              parseDigitalOrderPricesFromDetails(order, doc);
            } else {
              parseItemPricesFromDetails(order, doc);
              parsePromotionsFromDetails(order, doc);
            }
          }
        }

        if (order.orderId) {
          let origin = window.location.origin;
          if (order.detailsUrl) {
            try {
              origin = new URL(order.detailsUrl).origin;
            } catch {
              // Fall back to the current Amazon marketplace.
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 150));
          const txResponse = await fetch(buildTransactionUrl(origin, order.orderId), {
            credentials: 'include',
          });

          if (txResponse.ok) {
            const txHtml = await txResponse.text();
            const txDoc = new DOMParser().parseFromString(txHtml, 'text/html');
            order.transactions = parseTransactionsFromCPEDoc(txDoc).map((transaction) => ({
              ...transaction,
              paymentMethod: transaction.paymentMethod ?? fallbackPaymentDetails.paymentMethod,
              cardLast4: transaction.cardLast4 ?? fallbackPaymentDetails.cardLast4,
            }));
          } else {
            order.transactions = [];
            console.warn(
              `[Amazon Exporter] Transaction page returned ${txResponse.status} for ${order.orderId}`
            );
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (error) {
        console.warn('[Amazon Exporter] Error enriching order:', order.orderId, error);
      }
    }
  }

  /**
   * Parse Amazon CPE payment rows. We intentionally do not deduplicate solely by
   * date + amount: two genuine partial shipments can charge the same amount on
   * the same day and both must reach Finance Import.
   */
  function parseTransactionsFromCPEDoc(doc: Document): Transaction[] {
    const transactions: Transaction[] = [];
    const groups = doc.querySelectorAll('.a-box-group');

    for (const group of groups) {
      const dateEl = group.querySelector('.apx-transaction-date-container span');
      const date = parseOrderDate(dateEl?.textContent?.trim() || '');
      if (!date) continue;

      const amountEls = group.querySelectorAll(
        '.a-column.a-span3.a-text-right.a-span-last .a-size-base-plus.a-text-bold,' +
          '.apx-transactions-line-item-component-container .a-size-base-plus.a-text-bold'
      );
      const seenWithinGroup = new Set<string>();

      for (const amountEl of amountEls) {
        const parsed = parseCPETransactionAmount(
          amountEl.textContent?.trim() || '',
          window.location.hostname
        );
        if (!parsed) continue;

        // Amazon can render the same amount more than once inside one transaction
        // group. Collapse only those duplicates. Identical charges in separate groups
        // are intentionally preserved (e.g. two equal partial shipments on one day).
        const transactionContainer =
          amountEl.closest('.apx-transactions-line-item-component-container') || group;
        let paymentDetails = parsePaymentDetailsFromText(transactionContainer.textContent || '');
        if (!paymentDetails.paymentMethod && !paymentDetails.cardLast4) {
          paymentDetails = parsePaymentDetailsFromText(group.textContent || '');
        }

        const key = `${parsed.amount}:${parsed.currency}:${paymentDetails.paymentMethod || ''}:${paymentDetails.cardLast4 || ''}`;
        if (seenWithinGroup.has(key)) continue;
        seenWithinGroup.add(key);
        transactions.push({
          date,
          amount: parsed.amount,
          currency: parsed.currency,
          ...paymentDetails,
        });
      }
    }

    return transactions;
  }

  /** Parse the price of a digital item from its receipt/details page. */
  function parseDigitalOrderPricesFromDetails(order: Order, doc: Document): void {
    if (order.items.length === 0) return;

    const selectors = [
      '.a-price .a-offscreen',
      '.a-color-price',
      '[class*="grand-total"]',
      '[class*="order-total"] .a-color-price',
    ];

    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      const parsed = element
        ? extractPriceFromText(element.textContent || '', window.location.hostname)
        : null;
      if (parsed && parsed.amount > 0) {
        const firstItem = order.items[0];
        if (firstItem) firstItem.price = parsed.amount;
        return;
      }
    }

    const firstItem = order.items[0];
    if (firstItem && firstItem.price === 0 && order.totalAmount > 0) {
      firstItem.price = order.totalAmount;
    }
  }

  /**
   * Parse item prices from order details page
   */
  function parseItemPricesFromDetails(order: Order, doc: Document): void {
    const asinPriceMap = new Map<string, number>();

    // Look for product containers with prices
    // Amazon order details page typically has items in table rows or specific containers
    const itemContainers = doc.querySelectorAll(
      '.a-row, [class*="shipment-item"], [class*="od-shipment-item"], tr, .a-fixed-left-grid-inner'
    );

    itemContainers.forEach((container) => {
      const link = container.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]');
      if (!link) return;

      const asinMatch = (link.getAttribute('href') || '').match(
        /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i
      );
      if (!asinMatch?.[1]) return;

      const asin = asinMatch[1].toUpperCase();
      const text = container.textContent || '';

      // Try multiple price patterns - look for the item price specifically
      const pricePatterns = [
        new RegExp(`${CURRENCY_TOKEN}\\s*([0-9]+[.,][0-9]{2})`, 'gi'),
        new RegExp(`([0-9]+[.,][0-9]{2})\\s*${CURRENCY_TOKEN}`, 'gi'),
      ];

      for (const pattern of pricePatterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          if (match[1]) {
            const price = parsePrice(match[1]);
            if (price > 0) {
              // Store the first valid price found for this ASIN
              if (!asinPriceMap.has(asin)) {
                asinPriceMap.set(asin, price);
              }
              break;
            }
          }
        }
        if (asinPriceMap.has(asin)) break;
      }
    });

    // Also look for the order summary section for prices per item
    const orderSummary = doc.querySelector(
      '#orderSummary, .order-summary, [class*="order-summary"]'
    );
    if (orderSummary) {
      const summaryRows = orderSummary.querySelectorAll('.a-row, tr');
      summaryRows.forEach((row) => {
        const rowText = row.textContent || '';
        // Look for item-specific discounts
        const discountMatch = rowText.match(
          new RegExp(
            `(Rabatt|Nachlass|Ersparnis|Discount|Coupon)[:\\s]*-?\\s*${CURRENCY_TOKEN}?\\s*([0-9]+[.,][0-9]{2})`,
            'i'
          )
        );
        if (discountMatch?.[2]) {
          const discountAmount = parsePrice(discountMatch[2]);
          if (discountAmount > 0) {
            console.log(`[Amazon Exporter] Found discount in summary: ${discountAmount}`);
          }
        }
      });
    }

    // Update items with found prices
    order.items.forEach((item) => {
      const price = asinPriceMap.get(item.asin);
      if (price !== undefined) {
        item.price = price;
      }
    });

    // If some items still have no price, try to find them in a more aggressive search
    const itemsWithoutPrice = order.items.filter((item) => item.price === 0);
    if (itemsWithoutPrice.length > 0) {
      // Search the entire page for ASIN-price associations
      const pageText = doc.body.textContent || '';

      itemsWithoutPrice.forEach((item) => {
        // Look for price near the ASIN in the document
        const asinRegex = new RegExp(
          `${item.asin}[^€£$]*${CURRENCY_TOKEN}\\s*([0-9]+[.,][0-9]{2})`,
          'i'
        );
        const match = pageText.match(asinRegex);
        if (match?.[1]) {
          const price = parsePrice(match[1]);
          if (price > 0) {
            item.price = price;
          }
        }
      });
    }
  }

  /**
   * Parse promotions and discounts from order details page
   */
  function parsePromotionsFromDetails(order: Order, doc: Document): void {
    const promotions: Promotion[] = [];
    let totalSavings = 0;

    // Look for various discount/promotion patterns in the order details
    const promotionSelectors = [
      '[class*="promotion"]',
      '[class*="savings"]',
      '[class*="discount"]',
      '[class*="coupon"]',
      '.a-color-success',
      '.a-color-price',
    ];

    const checkedTexts = new Set<string>();

    promotionSelectors.forEach((selector) => {
      const elements = doc.querySelectorAll(selector);
      elements.forEach((el) => {
        const text = el.textContent?.trim() || '';
        if (checkedTexts.has(text)) return;
        checkedTexts.add(text);

        // Look for savings/discount amounts
        const savingsPatterns = [
          new RegExp(
            `(?:Rabatt|Nachlass|Ersparnis|Savings?|Discount|Gutschein|Coupon|Descuento|Ahorro|Cup[oó]n|Promoci[oó]n)[:\\s]*-?\\s*${CURRENCY_TOKEN}?\\s*([0-9]+[.,][0-9]{2})`,
            'i'
          ),
          new RegExp(`-\\s*${CURRENCY_TOKEN}\\s*([0-9]+[.,][0-9]{2})`, 'i'),
          new RegExp(`${CURRENCY_TOKEN}\\s*-\\s*([0-9]+[.,][0-9]{2})`, 'i'),
        ];

        for (const pattern of savingsPatterns) {
          const match = text.match(pattern);
          if (match?.[1]) {
            const amount = parsePrice(match[1]);
            if (amount > 0) {
              const description = text.replace(/\s+/g, ' ').trim().substring(0, 100);
              // Avoid duplicate promotions
              if (
                !promotions.some(
                  (p) => Math.abs(p.amount - amount) < 0.01 && p.description === description
                )
              ) {
                promotions.push({ description, amount });
                totalSavings += amount;
              }
              break;
            }
          }
        }
      });
    });

    // Also check the order summary section for totals
    const summarySection = doc.querySelector(
      '#orderSummary, .order-summary, [class*="order-summary"], .a-box.order-summary'
    );
    if (summarySection) {
      const rows = summarySection.querySelectorAll('.a-row, tr, div');
      rows.forEach((row) => {
        const text = row.textContent?.trim() || '';
        if (checkedTexts.has(text)) return;
        checkedTexts.add(text);

        // Look for promotion lines
        if (
          /Rabatt|Nachlass|Ersparnis|Savings?|Discount|Gutschein|Coupon|Angebot|Descuento|Ahorro|Cup[oó]n|Promoci[oó]n/i.test(
            text
          )
        ) {
          const amountMatch = text.match(
            new RegExp(
              `-?\\s*${CURRENCY_TOKEN}?\\s*([0-9]+[.,][0-9]{2})\\s*${CURRENCY_TOKEN}?`,
              'i'
            )
          );
          if (amountMatch?.[1]) {
            const amount = parsePrice(amountMatch[1]);
            if (amount > 0) {
              const description = text.replace(/\s+/g, ' ').trim().substring(0, 100);
              if (!promotions.some((p) => Math.abs(p.amount - amount) < 0.01)) {
                promotions.push({ description, amount });
                totalSavings += amount;
              }
            }
          }
        }
      });
    }

    // Calculate if there's an unexplained discount (items total > order total)
    const itemsTotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if (itemsTotal > order.totalAmount && order.totalAmount > 0) {
      const unexplainedDiscount = Math.round((itemsTotal - order.totalAmount) * 100) / 100;
      // Only add if we haven't already accounted for it
      if (unexplainedDiscount > totalSavings + 0.01) {
        const additionalDiscount = Math.round((unexplainedDiscount - totalSavings) * 100) / 100;
        if (additionalDiscount > 0.01) {
          promotions.push({
            description: getMessage('additionalDiscount'),
            amount: additionalDiscount,
          });
          totalSavings = unexplainedDiscount;
        }
      }
    }

    order.promotions = promotions;
    order.totalSavings = Math.round(totalSavings * 100) / 100;

    if (promotions.length > 0) {
      console.log(
        `[Amazon Exporter] Order ${order.orderId} has ${promotions.length} promotions, total savings: €${totalSavings}`
      );
    }
  }

  /**
   * Convert orders to CSV format (wrapper using utility function)
   */
  function convertToCSV(orders: Order[]): string {
    return convertOrdersToCSV(orders, getMessage);
  }

  /**
   * Update progress in popup
   */
  function updateProgress(percent: number, message: string): void {
    browser.runtime
      .sendMessage({
        action: 'updateProgress',
        data: { percent, message },
      })
      .catch(() => {
        // Popup might be closed
      });
  }
})();
