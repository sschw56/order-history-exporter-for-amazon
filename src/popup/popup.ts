/**
 * Order History Exporter for Amazon - Popup Script
 * Handles local exports and direct Finance Import delivery.
 */

import browser from 'webextension-polyfill';
import type {
  ExportDestination,
  ExportOptions,
  FinanceImportResponse,
  ProgressData,
} from '../types';
import {
  DEFAULT_FINANCE_IMPORT_URL,
  isAmazonOrderHistoryPage,
  normalizeFinanceBaseUrl,
} from '../utils';
import { STOP_FLAG_KEY } from '../constants';

const FINANCE_STORAGE_KEYS = {
  baseUrl: 'financeImportBaseUrl',
  token: 'financeImportToken',
  deviceName: 'financeImportDeviceName',
  lastSend: 'financeImportLastSend',
} as const;

function getMessage(key: string, substitutions?: string | string[]): string {
  return browser.i18n.getMessage(key, substitutions) || key;
}

function applyI18n(): void {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    if (key) {
      const message = getMessage(key);
      if (message) element.textContent = message;
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();

  const notAmazonEl = document.getElementById('not-amazon') as HTMLElement;
  const mainContentEl = document.getElementById('main-content') as HTMLElement;
  const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
  const financeBtn = document.getElementById('financeBtn') as HTMLButtonElement;
  const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
  const progressSection = document.getElementById('progress-section') as HTMLElement;
  const progressFill = document.getElementById('progressFill') as HTMLElement;
  const progressText = document.getElementById('progressText') as HTMLElement;
  const statusMessage = document.getElementById('status-message') as HTMLElement;
  const dateRangeInputs = document.getElementById('date-range-inputs') as HTMLElement;
  const startDateInput = document.getElementById('startDate') as HTMLInputElement;
  const endDateInput = document.getElementById('endDate') as HTMLInputElement;
  const settingsSection = document.getElementById('settings-section') as HTMLElement;
  const financeUrlInput = document.getElementById('financeUrl') as HTMLInputElement;
  const financeTokenInput = document.getElementById('financeToken') as HTMLInputElement;
  const financeDeviceNameInput = document.getElementById('financeDeviceName') as HTMLInputElement;
  const saveFinanceSettingsBtn = document.getElementById(
    'saveFinanceSettingsBtn'
  ) as HTMLButtonElement;
  const testFinanceBtn = document.getElementById('testFinanceBtn') as HTMLButtonElement;
  const financeSettingsStatus = document.getElementById('finance-settings-status') as HTMLElement;

  const today = new Date();
  endDateInput.value = today.toISOString().split('T')[0] || '';
  startDateInput.value = today.toISOString().split('T')[0] || '';

  const storedFinance = await browser.storage.local.get([
    FINANCE_STORAGE_KEYS.baseUrl,
    FINANCE_STORAGE_KEYS.token,
    FINANCE_STORAGE_KEYS.deviceName,
    FINANCE_STORAGE_KEYS.lastSend,
  ]);
  financeUrlInput.value = String(
    storedFinance[FINANCE_STORAGE_KEYS.baseUrl] || DEFAULT_FINANCE_IMPORT_URL
  );
  financeTokenInput.value = String(storedFinance[FINANCE_STORAGE_KEYS.token] || '');
  financeDeviceNameInput.value = String(storedFinance[FINANCE_STORAGE_KEYS.deviceName] || '');
  updateFinanceButtonState();

  const lastSend = storedFinance[FINANCE_STORAGE_KEYS.lastSend] as
    | (FinanceImportResponse & { at?: string })
    | undefined;
  if (lastSend?.success && lastSend.batchId) {
    showStatus(
      getMessage('financeLastSendSuccess', [
        String(lastSend.orderCount || ''),
        String(lastSend.batchId),
      ]),
      'info'
    );
  } else if (lastSend && lastSend.success === false && lastSend.error) {
    showStatus(getMessage('financeLastSendFailed', [lastSend.error]), 'error');
  }

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  const isAmazonOrderPage = currentTab?.url ? isAmazonOrderHistoryPage(currentTab.url) : false;

  if (isAmazonOrderPage) {
    mainContentEl.classList.remove('hidden');
  } else {
    notAmazonEl.classList.remove('hidden');
  }

  document.querySelectorAll('input[name="exportRange"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.value === 'dateRange') {
        dateRangeInputs.classList.remove('hidden');
      } else {
        dateRangeInputs.classList.add('hidden');
      }
    });
  });

  financeUrlInput.addEventListener('input', updateFinanceButtonState);
  financeTokenInput.addEventListener('input', updateFinanceButtonState);

  async function saveFinanceSettings(showSuccess = true): Promise<boolean> {
    try {
      const baseUrl = normalizeFinanceBaseUrl(financeUrlInput.value);
      const token = financeTokenInput.value.trim();
      const deviceName = financeDeviceNameInput.value.trim();

      if (!token) {
        showFinanceSettingsStatus(getMessage('financeSettingsMissing'), 'error');
        return false;
      }

      await browser.storage.local.set({
        [FINANCE_STORAGE_KEYS.baseUrl]: baseUrl,
        [FINANCE_STORAGE_KEYS.token]: token,
        [FINANCE_STORAGE_KEYS.deviceName]: deviceName,
      });
      financeUrlInput.value = baseUrl;
      updateFinanceButtonState();
      if (showSuccess) {
        showFinanceSettingsStatus(getMessage('financeSettingsSaved'), 'success');
      }
      return true;
    } catch (error) {
      showFinanceSettingsStatus(error instanceof Error ? error.message : String(error), 'error');
      return false;
    }
  }

  saveFinanceSettingsBtn.addEventListener('click', async () => {
    await saveFinanceSettings();
  });

  testFinanceBtn.addEventListener('click', async () => {
    testFinanceBtn.disabled = true;
    showFinanceSettingsStatus(getMessage('financeTesting'), 'info');

    try {
      const saved = await saveFinanceSettings(false);
      if (!saved) return;

      const response = (await browser.runtime.sendMessage({
        action: 'testFinanceImport',
      })) as FinanceImportResponse;

      if (response.success) {
        showFinanceSettingsStatus(getMessage('financeConnectionOk'), 'success');
      } else {
        showFinanceSettingsStatus(
          getMessage('financeConnectionFailed', [response.error || 'Unknown error']),
          'error'
        );
      }
    } catch (error) {
      showFinanceSettingsStatus(
        getMessage('financeConnectionFailed', [
          error instanceof Error ? error.message : String(error),
        ]),
        'error'
      );
    } finally {
      testFinanceBtn.disabled = false;
    }
  });

  exportBtn.addEventListener('click', async () => {
    await beginExport('download');
  });

  financeBtn.addEventListener('click', async () => {
    if (!financeUrlInput.value.trim() || !financeTokenInput.value.trim()) {
      showStatus(getMessage('financeSettingsMissing'), 'error');
      return;
    }

    const saved = await saveFinanceSettings(false);
    if (!saved) return;

    await beginExport('finance');
  });

  async function beginExport(destination: ExportDestination): Promise<void> {
    const exportRangeEl = document.querySelector(
      'input[name="exportRange"]:checked'
    ) as HTMLInputElement;
    const exportFormatEl = document.querySelector(
      'input[name="exportFormat"]:checked'
    ) as HTMLInputElement;
    const exportRange = exportRangeEl?.value || 'all';
    const exportFormat = (exportFormatEl?.value || 'json') as 'json' | 'csv';

    let startDate: string | null = null;
    let endDate: string | null = null;

    if (exportRange === 'dateRange') {
      startDate = startDateInput.value;
      endDate = endDateInput.value;

      if (!startDate || !endDate) {
        showStatus(getMessage('errorSelectDates'), 'error');
        return;
      }

      if (new Date(startDate) > new Date(endDate)) {
        showStatus(getMessage('errorDateOrder'), 'error');
        return;
      }
    }

    settingsSection.classList.add('hidden');
    exportBtn.classList.add('hidden');
    financeBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    stopBtn.disabled = false;
    showProgress(
      0,
      destination === 'finance'
        ? getMessage('financeSendStartedMessage')
        : getMessage('exportStartedMessage')
    );
    showStatus(
      destination === 'finance'
        ? getMessage('financeSendStartedStatus')
        : getMessage('exportStartedStatus'),
      'success'
    );

    try {
      if (!currentTab?.id) {
        resetUI();
        showStatus(getMessage('errorGetTab'), 'error');
        return;
      }

      const options: ExportOptions = {
        format: destination === 'finance' ? 'json' : exportFormat,
        destination,
        startDate,
        endDate,
        exportAll: exportRange === 'all',
      };

      const response = (await browser.tabs.sendMessage(currentTab.id, {
        action: 'exportOrders',
        options,
      })) as { success: boolean; error?: string };

      if (response.success) {
        showStatus(
          destination === 'finance'
            ? getMessage('financeSendInitiatedStatus')
            : getMessage('exportInitiatedStatus'),
          'success'
        );
      } else {
        resetUI();
        showStatus(response.error || getMessage('exportFailedGeneric'), 'error');
      }
    } catch (error) {
      console.error('Export error:', error);
      resetUI();
      showStatus(getMessage('exportFailedRefresh'), 'error');
    }
  }

  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;

    try {
      const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = activeTabs[0];
      if (tab?.id) {
        await browser.tabs.sendMessage(tab.id, { action: 'stopExport' });
        return;
      }
    } catch {
      try {
        await browser.storage.session.set({ [STOP_FLAG_KEY]: true });
      } catch {
        console.debug('[Amazon Exporter] Could not persist stop flag to storage.session');
      }
    }

    resetUI();
    showStatus(getMessage('exportStopped'), 'info');
  });

  function resetUI(): void {
    settingsSection.classList.remove('hidden');
    exportBtn.classList.remove('hidden');
    financeBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    hideProgress();
    updateFinanceButtonState();
  }

  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as {
      action: string;
      data?: ProgressData | { message?: string };
    };

    if (msg.action === 'exportStopped') {
      resetUI();
      showStatus(getMessage('exportStopped'), 'info');
      return;
    }

    if (msg.action === 'financeSendFailed') {
      resetUI();
      const data = msg.data as { message?: string } | undefined;
      showStatus(
        getMessage('financeConnectionFailed', [data?.message || getMessage('financeSendFailed')]),
        'error'
      );
      return;
    }

    if (msg.action === 'updateProgress' && msg.data) {
      const data = msg.data as ProgressData;
      showProgress(data.percent, data.message);

      if (data.percent >= 100) {
        resetUI();
        showStatus(data.message, 'success');
      }
    }
  });

  function updateFinanceButtonState(): void {
    financeBtn.disabled = !financeUrlInput.value.trim() || !financeTokenInput.value.trim();
  }

  function showProgress(percent: number, text: string): void {
    progressSection.classList.remove('hidden');
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
  }

  function hideProgress(): void {
    progressSection.classList.add('hidden');
  }

  function showStatus(message: string, type: 'success' | 'error' | 'info'): void {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.classList.remove('hidden');

    if (type === 'success' || type === 'info') {
      setTimeout(() => statusMessage.classList.add('hidden'), 7000);
    }
  }

  function showFinanceSettingsStatus(message: string, type: 'success' | 'error' | 'info'): void {
    financeSettingsStatus.textContent = message;
    financeSettingsStatus.className = `settings-status ${type}`;
    financeSettingsStatus.classList.remove('hidden');
  }
});
