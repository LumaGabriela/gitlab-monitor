import { Locator } from '@playwright/test';

/** Escolhe uma opção do `app-select`: abre a lista própria (sobreposição do CDK) e clica pelo rótulo. */
export async function choose(combobox: Locator, label: string): Promise<void> {
  await combobox.click();
  const listbox = combobox.page().getByRole('listbox');
  await listbox.getByRole('option', { name: label, exact: true }).click();
}
