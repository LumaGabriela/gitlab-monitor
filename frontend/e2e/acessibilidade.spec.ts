import { expect, test } from '@playwright/test';
import { goTo, openNav } from './support/navigation';
import { usePreferences } from './support/preferences';

test.describe('Acessibilidade do painel', () => {
  test.beforeEach(async ({ page }) => {
    await usePreferences(page);
    await page.goto('/');
    // O catálogo de tradução chega por HTTP DEPOIS da primeira renderização:
    // antes disso o texto na tela ainda é a chave crua, e qualquer localizador
    // por texto traduzido é uma corrida. Esperar o título já traduzido é o
    // sinal de que o catálogo entrou. A espera é mais longa que a padrão de
    // propósito: isto não afirma comportamento, é o preparo da jornada, e na
    // primeira carga do servidor de desenvolvimento ele leva mais que cinco
    // segundos para responder.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Merge requests abertos', {
      timeout: 15_000,
    });
  });

  test('a tabela tem legenda e cabeçalhos com escopo', async ({ page }) => {
    await expect(page.locator('table caption')).toHaveText('Merge requests abertos');
    const headers = page.locator('thead th');
    await expect(headers.first()).toHaveAttribute('scope', 'col');
  });

  test('a área rolável da tabela é alcançável pelo teclado', async ({ page }) => {
    // Sem tabindex, quem navega por teclado não consegue rolar para ver as
    // colunas da direita.
    const scroll = page.getByRole('region', { name: 'Merge requests abertos' });
    await expect(scroll).toHaveAttribute('tabindex', '0');
  });

  test('o filtro de autor abre e fecha pelo teclado', async ({ page }) => {
    const filtro = page.locator('.ui-toolbar').getByRole('button', { name: 'Autor' });
    await filtro.focus();
    await page.keyboard.press('Enter');
    await expect(filtro).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(filtro).toHaveAttribute('aria-expanded', 'false');
  });

  test('todo campo do formulário tem rótulo ligado ao controle', async ({ page }) => {
    await expect(page.getByLabel('Ordenar por')).toBeVisible();
    await expect(page.locator('.ui-toolbar').getByRole('button', { name: 'Autor' })).toBeVisible();

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Consulta');
    await expect(page.getByRole('button', { name: 'Projetos monitorados' })).toBeVisible();
    await expect(page.getByLabel('Intervalo (min)')).toBeVisible();
    await goTo(page, 'Notificações');
    await expect(page.getByLabel('Avisar no navegador')).toBeVisible();
  });

  test('o link do MR avisa que abre em outra aba', async ({ page }) => {
    const link = page.getByRole('link', { name: /BE #199/ });
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toContainText('nova aba');
  });

  test('a linha destacada por uma regra nomeia a regra, além de mudar de cor', async ({ page }) => {
    // O fundo sozinho some em escala de cinza e para leitor de tela: a regra
    // também chega por texto, e a legenda a explica.
    await usePreferences(page, {
      rowRules: [
        {
          id: 'r1',
          field: 'pipeline',
          operator: 'eq',
          value: 'failed',
          tone: 'danger',
          enabled: true,
        },
      ],
    });
    await page.goto('/');

    const linha = page.locator('tbody tr.ui-table__row--tone-danger').first();
    await expect(linha.locator('.ui-table__match')).toHaveText(/Pipeline falhou/);
    // Sem ícone: o canal que substitui a cor é o traço da borda e este texto.
    await expect(linha.locator('.ui-table__match app-icon')).toHaveCount(0);
    await expect(page.locator('.ui-legend__rule')).toContainText('Pipeline falhou');
  });

  test('o contador de likes é anunciado por extenso', async ({ page }) => {
    // "2" sozinho não diz nada a quem não vê a coluna.
    await expect(page.getByLabel('2 like(s), incluindo o seu')).toBeVisible();
  });

  test('em 375 px a página não rola na horizontal', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'vale só no projeto mobile');

    // O que rola é a casca, não o documento: os dois precisam caber na largura.
    const estoura = await page.evaluate((): boolean =>
      [document.documentElement, document.querySelector('.ui-shell')].some(
        (el) => el !== null && el.scrollWidth > el.clientWidth,
      ),
    );
    expect(estoura).toBe(false);
  });

  test('em 375 px a página de configurações não rola na horizontal', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'vale só no projeto mobile');

    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();

    // O que rola é a casca, não o documento: os dois precisam caber na largura.
    const estoura = await page.evaluate((): boolean =>
      [document.documentElement, document.querySelector('.ui-shell')].some(
        (el) => el !== null && el.scrollWidth > el.clientWidth,
      ),
    );
    expect(estoura).toBe(false);
  });

  test('pelo teclado, de /settings a /settings/columns, o foco vai ao título da seção', async ({
    page,
  }) => {
    await page.goto('/settings');
    const nav = await openNav(page);
    const colunas = nav.getByRole('link', { name: 'Colunas da tabela' });
    await colunas.focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/settings\/columns$/);
    const titulo = page.getByRole('heading', { level: 2, name: 'Colunas da tabela' });
    await expect(titulo).toBeFocused();
    await expect(titulo).toHaveAttribute('tabindex', '-1');
    // A navegação diz onde a pessoa está sem depender de cor.
    const aberta = (await openNav(page)).getByRole('link', { name: 'Colunas da tabela' });
    await expect(aberta).toHaveAttribute('aria-current', 'page');
    await expect(aberta).toHaveClass(/ui-nav-item--active/);
  });

  test('o foco acompanha a rota ao saltar entre seções', async ({ page }) => {
    await page.goto('/settings');

    await goTo(page, 'Colunas da tabela');
    await expect(page.getByRole('heading', { level: 2, name: 'Colunas da tabela' })).toBeFocused();

    await goTo(page, 'Exibição');
    await expect(page.getByRole('heading', { level: 2, name: 'Exibição' })).toBeFocused();

    await goTo(page, 'Consulta');
    await expect(page.getByRole('heading', { level: 2, name: 'Consulta' })).toBeFocused();
  });

  test('recarregar /settings/columns abre a seção, e a raiz cai na primeira', async ({ page }) => {
    await page.goto('/settings/columns');
    await expect(page.getByRole('heading', { level: 2, name: 'Colunas da tabela' })).toBeVisible();

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/query$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Consulta' })).toBeVisible();
  });

  test('mantém o alvo mínimo com densidade compacta e texto grande', async ({ browser }) => {
    // O alvo mínimo vale no toque (pointer: coarse); no mouse, os controles
    // têm o tamanho do Design System. A prova é no toque, que é onde ele
    // existe, e compara as duas densidades com o mesmo texto grande.
    const medir = async (density: string): Promise<{ nome: string; h: number; w: number }[]> => {
      const context = await browser.newContext({
        hasTouch: true,
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      await usePreferences(page, { density, textSize: 'lg' });
      await page.goto('/');
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      await expect(page.locator('html')).toHaveClass(/text-size-lg/);

      const controles = page.locator('.ui-page-tools :is(a, button):visible');
      expect(await controles.count()).toBeGreaterThan(0);
      const medidas = await controles.evaluateAll((els) =>
        els.map((el) => {
          const caixa = el.getBoundingClientRect();
          return {
            nome: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
            h: caixa.height,
            w: caixa.width,
          };
        }),
      );
      if (density === 'compact') {
        await expect(page.locator('html')).toHaveClass(/density-compact/);
        // A escala compacta está mesmo aplicada: o espaçamento encolheu.
        const espaco = await page.evaluate(() =>
          Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--spacing-4'),
          ),
        );
        expect(espaco).toBeLessThan(16);
        // ...mas o alvo mínimo de toque não vazou para a escala compacta.
        const alvo = await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--size-touch-min').trim(),
        );
        expect(alvo).toBe('44px');
      }
      await context.close();
      return medidas;
    };

    const confortavel = await medir('comfortable');
    const compacta = await medir('compact');

    expect(compacta.length).toBe(confortavel.length);
    compacta.forEach((controle, i) => {
      // Alvo de toque do cabeçalho (engrenagem, idioma, tema): nunca abaixo
      // de 44px, e compactar não pode encolher nenhum controle.
      expect(controle.h, `"${controle.nome}" abaixo de 44px de altura`).toBeGreaterThanOrEqual(44);
      expect(controle.w, `"${controle.nome}" abaixo de 44px de largura`).toBeGreaterThanOrEqual(44);
      expect(controle.h, `"${controle.nome}" encolheu`).toBeGreaterThanOrEqual(confortavel[i].h);
    });
  });

  test('o marcador da linha destacada não encolhe com a densidade compacta', async ({
    browser,
  }) => {
    // O traço da borda é o canal não cromático do destaque: tracejado e
    // pontilhado não podem cair para 2px (indistinguíveis) no modo compacto.
    const medir = async (density: string): Promise<{ largura: string; estilo: string }> => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await usePreferences(page, {
        density,
        rowRules: [
          {
            id: 'r1',
            field: 'pipeline',
            operator: 'eq',
            value: 'failed',
            tone: 'danger',
            enabled: true,
          },
        ],
      });
      await page.goto('/');
      // Em 1280 px a borda está na primeira célula; em 375 px a linha vira
      // cartão e ela passa para a própria linha.
      const linha = page.locator('tbody tr.ui-table__row--tone-danger').first();
      const medida = await linha.evaluate((tr) => {
        const alvos = [tr, tr.querySelector('td')!].map((el) => getComputedStyle(el));
        const css = alvos.find((c) => Number.parseFloat(c.borderLeftWidth) > 0) ?? alvos[0];
        return { largura: css.borderLeftWidth, estilo: css.borderLeftStyle };
      });
      await context.close();
      return medida;
    };

    const confortavel = await medir('comfortable');
    const compacta = await medir('compact');
    expect(Number.parseFloat(confortavel.largura)).toBeGreaterThanOrEqual(4);
    expect(compacta).toEqual(confortavel);
  });

  test('a seção Dados abre pelo teclado e todo controle tem nome', async ({ page }) => {
    await page.goto('/settings');
    const nav = await openNav(page);
    const dados = nav.getByRole('link', { name: 'Dados' });
    await dados.focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/settings\/data$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Dados' })).toBeFocused();
    const aberta = (await openNav(page)).getByRole('link', { name: 'Dados' });
    await expect(aberta).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    // Em 375 px a gaveta reaberta acima fecha antes de contar os botões da página.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Todo botão tem nome acessível; o input nativo fica fora da árvore e da tabulação.
    for (const botao of await page.getByRole('button').all()) {
      await expect(botao).not.toHaveAccessibleName('');
    }
    const input = page.locator('input[type="file"]');
    await expect(input).toHaveAttribute('aria-hidden', 'true');
    await expect(input).toHaveAttribute('tabindex', '-1');
    // O resultado é uma região viva sempre presente.
    await expect(page.locator('[data-test="data-result"]')).toHaveAttribute('role', 'status');
  });

  test('em 375 e 1280 px a seção Dados não rola na horizontal', async ({ page }) => {
    await page.goto('/settings/data');
    await expect(page.getByRole('heading', { level: 2, name: 'Dados' })).toBeVisible();

    // O que rola é a casca, não o documento: os dois precisam caber na largura.
    const estoura = await page.evaluate((): boolean =>
      [document.documentElement, document.querySelector('.ui-shell')].some(
        (el) => el !== null && el.scrollWidth > el.clientWidth,
      ),
    );
    expect(estoura).toBe(false);
  });

  test('importar um arquivo pelo teclado: escolher, confirmar e recarregar', async ({ page }) => {
    await page.goto('/settings/data');
    const escolher = page.getByRole('button', { name: 'Escolher arquivo…' });
    await escolher.focus();
    await expect(escolher).toBeFocused();

    // O seletor nativo do sistema não é automatizável: o arquivo entra pelo input,
    // que é o que o botão abre. O resto do fluxo é só teclado.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'preferencias.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, preferences: { theme: 'dark' } })),
    });
    const substituir = page.getByRole('button', { name: 'Substituir' });
    await expect(substituir).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(substituir).toBeFocused();
    // Importar recarrega a página, e a recarga só pinta depois de o app
    // initializer reler as preferências. Esperar a carga e a seção de pé é o
    // que separa "o tema não foi aplicado" de "a página ainda está subindo".
    const recarregou = page.waitForEvent('load');
    await page.keyboard.press('Enter');
    await recarregou;
    await expect(page.getByRole('heading', { level: 2, name: 'Dados' })).toBeVisible();

    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('o link Pular para o conteúdo leva o foco ao main#conteudo', async ({ page }) => {
    await page.keyboard.press('Tab');
    const pular = page.getByRole('link', { name: 'Pular para o conteúdo' });
    await expect(pular).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('main#conteudo')).toBeFocused();
  });
});
