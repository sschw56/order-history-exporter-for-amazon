/**
 * Order History Exporter for Amazon - Background Script
 * Handles file downloads and Finance Import communication.
 */

import browser from 'webextension-polyfill';
import type {
  DownloadData,
  FinanceImportResponse,
  FinanceImportSendData,
  FinanceImportSettings,
  MessagePayload,
} from '../types';
import {
  DEFAULT_FINANCE_IMPORT_URL,
  FINANCE_API_PATH,
  FINANCE_HEALTH_PATH,
  buildFinanceUrl,
  normalizeFinanceBaseUrl,
} from '../utils';

const FINANCE_STORAGE_KEYS = {
  baseUrl: 'financeImportBaseUrl',
  token: 'financeImportToken',
  deviceName: 'financeImportDeviceName',
  instanceId: 'financeImportInstanceId',
  lastSend: 'financeImportLastSend',
} as const;

/** Get localized message from browser i18n API. */
function getMessage(key: string, substitutions?: string | string[]): string {
  return browser.i18n.getMessage(key, substitutions) || key;
}

async function ensureInstanceId(current?: string): Promise<string> {
  if (current) return current;

  const generated = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `finance-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await browser.storage.local.set({
    [FINANCE_STORAGE_KEYS.instanceId]: generated,
  });
  return generated;
}

async function getFinanceSettings(): Promise<FinanceImportSettings> {
  const stored = await browser.storage.local.get([
    FINANCE_STORAGE_KEYS.baseUrl,
    FINANCE_STORAGE_KEYS.token,
    FINANCE_STORAGE_KEYS.deviceName,
    FINANCE_STORAGE_KEYS.instanceId,
  ]);

  const baseUrl = normalizeFinanceBaseUrl(
    String(stored[FINANCE_STORAGE_KEYS.baseUrl] || DEFAULT_FINANCE_IMPORT_URL)
  );
  const token = String(stored[FINANCE_STORAGE_KEYS.token] || '').trim();
  const deviceName = String(stored[FINANCE_STORAGE_KEYS.deviceName] || '').trim();
  const instanceId = await ensureInstanceId(
    String(stored[FINANCE_STORAGE_KEYS.instanceId] || '').trim()
  );

  if (!token) {
    throw new Error(getMessage('financeSettingsMissing'));
  }

  return { baseUrl, token, deviceName, instanceId };
}

async function financeFetch(
  path: string,
  settings: FinanceImportSettings,
  init: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    return await fetch(buildFinanceUrl(settings.baseUrl, path), {
      ...init,
      headers: {
        Authorization: `Bearer ${settings.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'omit',
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (payload.detail) return payload.detail;
  } catch {
    // Ignore non-JSON error bodies.
  }

  return `HTTP ${response.status}`;
}

async function testFinanceImportConnection(): Promise<FinanceImportResponse> {
  try {
    const settings = await getFinanceSettings();
    const response = await financeFetch(FINANCE_HEALTH_PATH, settings);

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: await responseError(response),
      };
    }

    return { success: true, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendToFinanceImport(data: FinanceImportSendData): Promise<FinanceImportResponse> {
  try {
    const settings = await getFinanceSettings();
    const payload = {
      schemaVersion: 1,
      exportedAt: data.exportedAt,
      source: {
        extensionVersion: browser.runtime.getManifest().version,
        instanceId: settings.instanceId,
        deviceName: settings.deviceName,
        amazonHost: data.amazonHost,
      },
      orders: data.orders,
    };

    const response = await financeFetch(FINANCE_API_PATH, settings, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const result: FinanceImportResponse = {
        success: false,
        status: response.status,
        error: await responseError(response),
      };
      await browser.storage.local.set({
        [FINANCE_STORAGE_KEYS.lastSend]: {
          ...result,
          at: new Date().toISOString(),
        },
      });
      return result;
    }

    const responsePayload = (await response.json()) as FinanceImportResponse;
    const result: FinanceImportResponse = {
      ...responsePayload,
      success: true,
      status: response.status,
    };

    await browser.storage.local.set({
      [FINANCE_STORAGE_KEYS.lastSend]: {
        ...result,
        at: new Date().toISOString(),
      },
    });

    return result;
  } catch (error) {
    const result: FinanceImportResponse = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
    await browser.storage.local.set({
      [FINANCE_STORAGE_KEYS.lastSend]: {
        ...result,
        at: new Date().toISOString(),
      },
    });
    return result;
  }
}

// Listen for messages from content scripts and popup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
browser.runtime.onMessage.addListener((message: any, _sender: any) => {
  const msg = message as MessagePayload;

  if (msg.action === 'downloadFile') {
    return downloadFile(msg.data as DownloadData)
      .then(() => ({ success: true }))
      .catch((error: Error) => ({ success: false, error: error.message }));
  }

  if (msg.action === 'sendToFinanceImport') {
    return sendToFinanceImport(msg.data as FinanceImportSendData);
  }

  if (msg.action === 'testFinanceImport') {
    return testFinanceImportConnection();
  }

  if (msg.action === 'updateProgress' || msg.action === 'financeSendFailed') {
    browser.runtime.sendMessage(message).catch(() => {
      // Popup might be closed, ignore error.
    });
  }

  return undefined;
});

/** Download file using the browser's download API. */
async function downloadFile(data: DownloadData): Promise<number> {
  const { content, fileName, mimeType } = data;

  let url: string;
  let isObjectUrl = false;

  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    const blob = new Blob([content], { type: mimeType });
    url = URL.createObjectURL(blob);
    isObjectUrl = true;
  } else {
    const base64Content = globalThis.btoa(unescape(encodeURIComponent(content)));
    url = `data:${mimeType};base64,${base64Content}`;
  }

  try {
    const downloadId = await browser.downloads.download({
      url,
      filename: fileName,
      saveAs: true,
    });

    if (isObjectUrl) {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    return downloadId;
  } catch (error) {
    if (isObjectUrl) URL.revokeObjectURL(url);
    throw error;
  }
}

browser.runtime.onInstalled.addListener((details: { reason: string }) => {
  if (details.reason === 'install') {
    console.log(getMessage('extensionInstalled'));
  } else if (details.reason === 'update') {
    console.log(getMessage('extensionUpdated'), browser.runtime.getManifest().version);
  }
});
