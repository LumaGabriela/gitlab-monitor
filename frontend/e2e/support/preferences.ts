import { Page } from '@playwright/test';
import { Preferences } from '../../src/app/core/models/api/preferences-api.model';

/**
 * Isola as preferências de cada teste. A suíte roda em `fullyParallel` e o
 * documento do mock é um só: sem isto, o que um teste grava vazaria para os
 * outros. Registre antes do `goto`. Devolve uma função que lê o último
 * documento gravado pela página.
 */
export async function usePreferences(
  page: Page,
  initial: Preferences = {},
): Promise<() => Preferences> {
  let stored: Preferences = initial;
  await page.route('**/preferences', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { preferences: Preferences };
      stored = body.preferences;
      await route.fulfill({ json: { version: 1, preferences: stored } });
      return;
    }
    await route.fulfill({
      json: { version: 1, preferences: stored, file: 'user-data/preferences.json' },
    });
  });
  return (): Preferences => stored;
}
