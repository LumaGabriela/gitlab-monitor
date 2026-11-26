import { Locator, Page } from '@playwright/test';

/**
 * A navegação lateral. Em 375 px ela mora na gaveta: se o botão de abrir o menu está à vista, a
 * gaveta abre antes de devolver o localizador.
 */
export async function openNav(page: Page): Promise<Locator> {
  // A casca só existe depois do inicializador assíncrono das preferências: sem esperar por ela, o teste de visibilidade abaixo é instantâneo e erra.
  await page.locator('.ui-shell').waitFor();
  // Pela classe, e não pelo nome: logo depois de um `goto` o catálogo ainda não chegou e o nome é a chave crua.
  const abrir = page.locator('.ui-shell__menu-button');
  if (await abrir.isVisible()) {
    await abrir.click();
  }
  return page.getByRole('navigation', { name: 'Navegação principal' });
}

/** Vai a uma entrada da navegação lateral pelo nome. */
export async function goTo(page: Page, name: string): Promise<void> {
  const nav = await openNav(page);
  await nav.getByRole('link', { name, exact: true }).click();
}
