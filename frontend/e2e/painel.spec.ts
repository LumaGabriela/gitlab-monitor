import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { Preferences } from '../src/app/core/models/api/preferences-api.model';
import { goTo, openNav } from './support/navigation';
import { usePreferences } from './support/preferences';
import { choose } from './support/select';

test.describe('Painel de merge requests', () => {
  let gravadas: () => Preferences;

  test.beforeEach(async ({ page }) => {
    // Cada jornada tem o seu documento de preferências: o do mock é um só e a
    // suíte roda em paralelo.
    gravadas = await usePreferences(page);
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

  test('abre em português, com a tabela dos MRs do alvo', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Merge requests abertos');
    await expect(page.getByRole('columnheader', { name: 'Autor' })).toBeVisible();
    await expect(page.getByRole('link', { name: /BE #199/ })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });

  test('o filtro de autor marca vários sem fechar o painel', async ({ page }) => {
    // O nome acessível do gatilho vem do rótulo do campo ("Autor"), não do
    // resumo que ele mostra ("Todos").
    await page.locator('.ui-toolbar').getByRole('button', { name: 'Autor' }).click();

    await page.getByRole('checkbox', { name: 'ana.lima' }).check();
    // O painel continua aberto: é o que permite somar o segundo autor.
    await expect(page.getByRole('checkbox', { name: 'geovana.medeiros' })).toBeVisible();

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /FE|BE #7/ })).toBeVisible();
  });

  test('limpar filtros devolve todas as linhas', async ({ page }) => {
    await page.locator('.ui-toolbar').getByRole('button', { name: 'Autor' }).click();
    await page.getByRole('checkbox', { name: 'ana.lima' }).check();
    await expect(page.locator('tbody tr')).toHaveCount(1);

    // Fecha o painel antes: aberto, ele cobre o resto da barra em 375 px.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });

  test('o filtro de revisão reduz a tabela e sobrevive a um recarregamento', async ({ page }) => {
    await expect(page.locator('tbody tr')).toHaveCount(2);

    await page.locator('.ui-toolbar').getByRole('button', { name: 'Revisão' }).click();
    await page.getByRole('checkbox', { name: 'Atribuídos a mim' }).check();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /BE #199/ })).toBeVisible();

    await page.reload();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /BE #199/ })).toBeVisible();
  });

  test('aplicar o preset "Preciso revisar" pela barra muda a tabela e sobrevive a um recarregamento', async ({
    page,
  }) => {
    await expect(page.locator('tbody tr')).toHaveCount(2);

    await choose(
      page.locator('.ui-toolbar').getByRole('combobox', { name: 'Preset' }),
      'Preciso revisar',
    );
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /BE #199/ })).toBeVisible();
    // O estado reproduz o preset por inteiro (inclusive a ordenação), então o
    // seletor segue nele em vez de voltar ao item de apresentação.
    const seletor = page.locator('.ui-toolbar').getByRole('combobox', { name: 'Preset' });
    await expect(seletor).toHaveText('Preciso revisar');
    // O preset também liga a regra de destaque de revisão pendente, que aparece na legenda.
    await expect(page.locator('.ui-monitor-panel')).toContainText(
      'Revisão pendente atribuída a mim',
    );

    await page.reload();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /BE #199/ })).toBeVisible();
    await expect(seletor).toHaveText('Preciso revisar');

    // Editar um filtro à mão desfaz o preset: o seletor não afirma mais nada.
    await page.locator('.ui-toolbar').getByRole('button', { name: 'Revisão' }).click();
    await page.getByRole('checkbox', { name: 'Sem responsável' }).check();
    await page.keyboard.press('Escape');
    await expect(seletor).toHaveText('Nenhum preset');
  });

  test('salvar o atual em Configurações cria um preset que a barra passa a oferecer', async ({
    page,
  }) => {
    await page.locator('.ui-toolbar').getByRole('button', { name: 'Revisão' }).click();
    await page.getByRole('checkbox', { name: 'Atribuídos a mim' }).check();
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Presets');
    await expect(page.getByRole('heading', { level: 2, name: 'Presets' })).toBeFocused();
    await page.getByLabel('Nome do novo preset').fill('Só os meus');
    await page.getByRole('button', { name: 'Salvar o atual como preset' }).click();
    await expect(page.locator('#predefinicoes').getByRole('status')).toContainText('Preset salvo.');
    await goTo(page, 'Painel');

    await page.locator('.ui-toolbar').getByRole('combobox', { name: 'Preset' }).click();
    await expect(
      page.getByRole('listbox').getByRole('option', { name: 'Só os meus' }),
    ).toBeVisible();
  });

  test('duas opções de revisão somam as linhas, não ficam só com a primeira', async ({ page }) => {
    await page.locator('.ui-toolbar').getByRole('button', { name: 'Revisão' }).click();
    await page.getByRole('checkbox', { name: 'Atribuídos a mim' }).check();
    await expect(page.locator('tbody tr')).toHaveCount(1);

    await page.getByRole('checkbox', { name: 'Sem responsável' }).check();
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });

  test('esconder uma coluna, pelas configurações, tira a coluna da tabela', async ({ page }) => {
    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Colunas da tabela');
    await page.getByRole('checkbox', { name: 'Conflitos' }).uncheck();
    await goTo(page, 'Painel');

    // A tabela só existe depois de /data: conferir a ausência primeiro daria
    // zero porque nada foi desenhado ainda, e o teste não falharia nem se a
    // coluna voltasse. Uma coluna que CONTINUA na tabela é o sinal de que ela
    // já está no ar.
    await expect(page.getByRole('columnheader', { name: 'Autor' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Conflitos' })).toHaveCount(0);
  });

  test('mover uma coluna pelas configurações muda a ordem da tabela e sobrevive ao recarregar', async ({
    page,
  }) => {
    const cabecalhos = async (): Promise<string[]> => {
      // A tabela chega depois de /data: ler antes devolveria a lista vazia.
      // Em tela estreita o cabeçalho vira rótulo de cartão, então só existir basta.
      await expect(page.locator('thead th').first()).toBeAttached();
      return page
        .locator('thead th')
        .evaluateAll((ths) => ths.map((th) => th.textContent?.trim() ?? ''));
    };
    const antes = await cabecalhos();

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Colunas da tabela');
    // O primeiro botão de cima habilitado é o da segunda coluna.
    await page
      .locator('.ui-settings__column')
      .nth(1)
      .getByRole('button', { name: /^Mover .* para cima$/ })
      .click();
    await expect(page.locator('#colunas').getByRole('status')).toContainText(
      'agora é a coluna 1 de',
    );
    await goTo(page, 'Painel');

    const depois = await cabecalhos();
    expect(depois[0]).toBe(antes[1]);
    expect(depois[1]).toBe(antes[0]);

    await page.reload();
    expect(await cabecalhos()).toEqual(depois);
  });

  test('mover colunas só pelo teclado não perde o foco', async ({ page }) => {
    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Colunas da tabela');
    const linhas = page.locator('.ui-settings__column');
    const foco = (): Promise<string | null> =>
      page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
    const nome = await linhas.nth(1).locator('.ui-checkbox, label').first().innerText();

    const sobe = linhas.nth(1).getByRole('button', { name: /para cima$/ });
    await sobe.focus();
    await page.keyboard.press('Enter');
    // A coluna foi para a 1a posição: "para cima" ficou desabilitado e o foco
    // passou ao botão oposto da mesma coluna, em vez de se perder.
    await expect.poll(foco).toMatch(/para baixo$/);
    expect(await foco()).toContain(nome.trim());
    // Segundo Enter: desce de novo, e o foco acompanha a coluna.
    await page.keyboard.press('Enter');
    await expect.poll(foco).toMatch(/para baixo$/);
    expect(await foco()).toContain(nome.trim());
  });

  test('o cabeçalho e o select de ordenação são o mesmo estado', async ({ page }) => {
    const cabecalho = page.getByRole('columnheader', { name: 'Autor' });
    await expect(cabecalho).not.toHaveAttribute('aria-sort', /.+/);

    await cabecalho.getByRole('button').click();

    // A seta aparece no cabeçalho e o select passa a mostrar a mesma ordem.
    await expect(cabecalho).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.getByLabel('Ordenar por')).toHaveText('Autor');
    await expect(page.locator('tbody tr').first()).toContainText('ana.lima');
  });

  test('clicar de novo no mesmo cabeçalho inverte a ordem, e sobrevive ao recarregar', async ({
    page,
  }) => {
    const cabecalho = page.getByRole('columnheader', { name: 'Autor' });
    const primeira = page.locator('tbody tr').first();
    await cabecalho.getByRole('button').click();
    await expect(primeira).toContainText('ana.lima');

    await cabecalho.getByRole('button').click();

    await expect(cabecalho).toHaveAttribute('aria-sort', 'descending');
    await expect(primeira).toContainText('geovana.medeiros');

    // O sentido é preferência de quem olha: fica guardado como os filtros.
    await page.reload();
    await expect(page.getByRole('columnheader', { name: 'Autor' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(page.locator('tbody tr').first()).toContainText('geovana.medeiros');
  });

  test('escolher a ordem no select marca o cabeçalho correspondente', async ({ page }) => {
    await choose(page.getByLabel('Ordenar por'), 'Likes');

    await expect(page.getByRole('columnheader', { name: 'Likes' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  test('o idioma escolhido vale na página e sobrevive ao recarregar', async ({ page }) => {
    await page.getByRole('button', { name: 'Inglês' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open merge requests');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open merge requests');
  });

  test('o tamanho do texto muda a escala inteira', async ({ page }) => {
    const titulo = page.getByRole('heading', { level: 1 });
    const antes = await titulo.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Exibição');
    await choose(page.getByLabel('Tamanho do texto'), 'Grande');
    await goTo(page, 'Painel');

    const depois = await titulo.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(depois).toBeGreaterThan(antes);
  });

  test('trocar o tema e o tamanho do texto grava os dois no documento de preferências', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Mudar para o tema escuro' }).click();
    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Exibição');
    await choose(page.getByLabel('Tamanho do texto'), 'Grande');

    await expect.poll(() => gravadas()).toMatchObject({ theme: 'dark', textSize: 'lg' });
  });

  test('o destaque de likes só aparece a partir do limite escolhido', async ({ page }) => {
    // O MR do mock tem 2 likes; o padrão zero não destaca nada.
    const selo = page.getByLabel('2 like(s), incluindo o seu');
    await expect(selo).not.toHaveClass(/ui-tag--strong/);

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Exibição');
    await page.getByLabel('Destacar a partir de quantos likes').fill('2');
    await goTo(page, 'Painel');

    await expect(selo).toHaveClass(/ui-tag--strong/);
  });

  test('uma regra de destaque pinta só a linha que casa, sobrevive ao recarregar e some ao remover', async ({
    page,
  }) => {
    const linhaFalha = page.locator('tbody tr', { hasText: 'BE #7' });
    const linhaOk = page.locator('tbody tr', { hasText: 'BE #199' });
    await expect(linhaFalha).not.toHaveClass(/--tone-/);

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Destaques de linha');
    await page.getByRole('button', { name: 'Pipeline falhou' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Alteração salva.' })).toBeVisible();
    await goTo(page, 'Painel');

    await expect(linhaFalha).toHaveClass(/ui-table__row--tone-danger/);
    await expect(linhaOk).not.toHaveClass(/--tone-/);

    await page.reload();
    await expect(linhaFalha).toHaveClass(/ui-table__row--tone-danger/);

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Destaques de linha');
    await page.getByRole('button', { name: 'Remover regra 1' }).click();
    await goTo(page, 'Painel');

    await expect(linhaFalha).not.toHaveClass(/--tone-/);
  });

  test('descer uma regra de destaque faz a outra pintar a linha que as duas casam', async ({
    page,
  }) => {
    // BE #7 tem pipeline falhou e está parado há 80 horas: casa com as duas.
    const linha = page.locator('tbody tr', { hasText: 'BE #7' });

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Destaques de linha');
    await page.getByRole('button', { name: 'Pipeline falhou' }).click();
    await page.getByRole('button', { name: 'Parado há 3 dias' }).click();
    await goTo(page, 'Painel');
    // A de cima vence.
    await expect(linha).toHaveClass(/ui-table__row--tone-danger/);

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Destaques de linha');
    await page.locator('.ui-rule-list__rule').first().locator('[data-move="1"]').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'A regra agora é a 2 de 2' }),
    ).toBeAttached();
    await goTo(page, 'Painel');

    await expect(linha).toHaveClass(/ui-table__row--tone-warning/);
    await expect(linha).not.toHaveClass(/ui-table__row--tone-danger/);
  });

  test('a linha que casa com duas regras nomeia as duas, e a cor é a da primeira', async ({
    page,
  }) => {
    // BE #7 tem pipeline falhou (danger) e está parado há 80 horas (warning):
    // casa com as duas, em tons diferentes.
    const linha = page.locator('tbody tr', { hasText: 'BE #7' });

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Destaques de linha');
    await page.getByRole('button', { name: 'Pipeline falhou' }).click();
    await page.getByRole('button', { name: 'Parado há 3 dias' }).click();
    await goTo(page, 'Painel');

    // Um texto só, com as duas regras, e nenhum ícone na linha.
    await expect(linha.locator('.ui-table__match')).toHaveText(/Pipeline falhou.*Parado/);
    await expect(linha.locator('.ui-table__match app-icon')).toHaveCount(0);
    await expect(linha).toHaveClass(/ui-table__row--tone-danger/);
  });

  test('o tema escuro vale para a página inteira e sobrevive ao recarregar', async ({ page }) => {
    await page.getByRole('button', { name: 'Mudar para o tema escuro' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    // Agora o botão oferece o caminho de volta.
    await expect(page.getByRole('button', { name: 'Mudar para o tema claro' })).toBeVisible();
  });

  test('exportar baixa um arquivo com o app e as preferências guardadas', async ({ page }) => {
    await page.getByRole('button', { name: 'Mudar para o tema escuro' }).click();
    await expect.poll(() => gravadas()).toMatchObject({ theme: 'dark' });
    await page.goto('/settings/data');
    await expect(page.getByRole('heading', { level: 2, name: 'Dados' })).toBeVisible();
    await expect(page.getByText('user-data/preferences.json')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar preferências' }).click();
    const arquivo = await download;

    expect(arquivo.suggestedFilename()).toMatch(
      /^gitlab-monitor-preferences-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const corpo = JSON.parse(await readFile((await arquivo.path())!, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(corpo['app']).toBe('gitlab-monitor');
    expect(corpo['preferences']).toMatchObject({ theme: 'dark' });
  });

  test('importar pede confirmação, grava o documento importado e recarrega com o tema dele', async ({
    page,
  }) => {
    await page.goto('/settings/data');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    const importado = { theme: 'dark', textSize: 'lg', presets: [] };

    await page.locator('input[type="file"]').setInputFiles({
      name: 'preferencias.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ app: 'gitlab-monitor', version: 1, preferences: importado }),
      ),
    });
    await expect(page.getByText(/substitui tudo/i)).toBeVisible();
    // Nada muda antes de confirmar.
    expect(gravadas()).toEqual({});

    // Importar recarrega a página, e a recarga só pinta depois de o app
    // initializer reler as preferências. Esperar a carga e a seção de pé é o
    // que separa "o tema não foi aplicado" de "a página ainda está subindo".
    const recarregou = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Substituir' }).click();
    await recarregou;
    await expect(page.getByRole('heading', { level: 2, name: 'Dados' })).toBeVisible();

    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(gravadas()).toEqual(importado);
  });

  test('um arquivo que não serve mostra o erro e não muda nada', async ({ page }) => {
    await page.goto('/settings/data');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'ruim.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"app":"outra","version":1,"preferences":{}}'),
    });

    await expect(page.getByText('exportado por outra ferramenta')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Substituir' })).toHaveCount(0);
    expect(gravadas()).toEqual({});
  });

  test('a engrenagem leva à página de configurações, e a página sobrevive ao recarregar', async ({
    page,
  }) => {
    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    // A raiz não tem tela própria: ela cai na primeira seção.
    await expect(page).toHaveURL(/\/settings\/query$/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  });

  test('a linha de estado nomeia o alvo e a última coleta, e as ferramentas seguem idioma, tema, configurações', async ({
    page,
  }) => {
    const estado = page.locator('.ui-status-line');
    await expect(estado).toHaveClass(/ui-status-line--ok/);
    await expect(estado).toContainText('Alvos:');
    await expect(estado).toContainText('Última coleta');

    const ferramentas = page.locator('.ui-page-tools').locator('> *');
    await expect(ferramentas.last()).toHaveAttribute('aria-label', 'Abrir configurações');
  });

  for (const tema of ['claro', 'escuro'] as const) {
    test(`a linha de estado se destaca do fundo da página no tema ${tema}`, async ({ page }) => {
      if (tema === 'escuro') {
        await page.getByRole('button', { name: 'Mudar para o tema escuro' }).click();
        await expect(page.locator('html')).toHaveClass(/dark/);
      }
      const cores = await page.locator('.ui-status-line').evaluate((faixa) => {
        // O fundo "atrás" é o primeiro ancestral com cor própria, não só o body.
        let atras: Element | null = faixa.parentElement;
        while (atras && getComputedStyle(atras).backgroundColor === 'rgba(0, 0, 0, 0)') {
          atras = atras.parentElement;
        }
        return {
          faixa: getComputedStyle(faixa).backgroundColor,
          atras: atras ? getComputedStyle(atras).backgroundColor : '',
          body: getComputedStyle(document.body).backgroundColor,
        };
      });

      expect(cores.faixa).not.toBe('rgba(0, 0, 0, 0)');
      expect(cores.faixa).not.toBe(cores.atras);
      expect(cores.faixa).not.toBe(cores.body);
    });
  }

  test('escolhe dois projetos na aba Consulta e a tabela passa a mostrar os dois', async ({
    page,
  }) => {
    // A preferência só semeia o rascunho da caixa de seleção. Quem prova que o
    // Salvar gravou é o corpo do POST: o estado do mock é global e a suíte
    // roda em paralelo, então `meta` sozinho poderia vir de outro teste.
    await usePreferences(page, { monitoredProjects: ['grupo%2Fprojeto'] });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Merge requests abertos');
    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Consulta');
    await page.getByRole('button', { name: 'Projetos monitorados' }).click();
    await page.getByRole('checkbox', { name: 'grupo/outro', exact: true }).check();
    await page.keyboard.press('Escape');
    const envio = page.waitForRequest(
      (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/settings',
    );
    await page.getByRole('button', { name: 'Salvar' }).click();
    expect((await envio).postDataJSON().projects).toEqual(['grupo%2Fprojeto', 'grupo%2Foutro']);
    await goTo(page, 'Painel');

    const meta = page.locator('.ui-status-line');
    await expect(meta).toContainText('grupo/projeto');
    await expect(meta).toContainText('grupo/outro');
  });

  test('a busca da lista de projetos filtra e a escolha filtrada é salva', async ({ page }) => {
    await usePreferences(page, { monitoredProjects: ['grupo%2Fprojeto'] });
    await page.goto('/settings/query');
    await page.getByRole('button', { name: 'Projetos monitorados' }).click();

    const busca = page.getByRole('textbox', { name: 'Buscar…' });
    await expect(busca).toBeFocused();
    await busca.fill('outro');
    await expect(page.getByRole('checkbox')).toHaveCount(1);

    // Filtrar não desmarca o que está fora do termo: o POST leva os dois.
    await page.getByRole('checkbox', { name: 'grupo/outro', exact: true }).check();
    await busca.fill('zzz');
    await expect(page.getByText('Nenhuma opção encontrada.')).toBeVisible();
    await page.keyboard.press('Escape');

    const envio = page.waitForRequest(
      (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/settings',
    );
    await page.getByRole('button', { name: 'Salvar' }).click();
    expect((await envio).postDataJSON().projects).toEqual(['grupo%2Fprojeto', 'grupo%2Foutro']);
  });

  test('a busca do select de uma escolha só filtra e escolhe', async ({ page }) => {
    await page.goto('/');
    const ordenar = page.getByRole('combobox', { name: 'Ordenar por' });
    await ordenar.click();

    const busca = page.getByRole('textbox', { name: 'Buscar…' });
    await busca.fill('autor');
    const lista = page.getByRole('listbox');
    await expect(lista.getByRole('option')).toHaveCount(1);
    await lista.getByRole('option', { name: 'Autor', exact: true }).click();

    await expect(ordenar).toContainText('Autor');
    // A escolha feita pela busca é a mesma do cabeçalho: a coluna Autor passa
    // a ser a ordenada, no sentido natural dela.
    await expect(page.locator('th', { hasText: 'Autor' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  test('a aba Consulta avisa quando a lista de projetos falha', async ({ page }) => {
    await page.route('**/projects', (route) =>
      route.fulfill({ status: 502, json: { error: 'Unexpected response from GitLab.' } }),
    );
    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Consulta');

    await expect(page.getByText('Não foi possível carregar os projetos do GitLab.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Projetos monitorados' })).toHaveCount(0);
  });

  test('sem nenhum alvo escolhido a tabela dá lugar a um convite para escolher', async ({
    page,
  }) => {
    // Distinto de "nenhum MR aberto": aqui não há o que consultar.
    await page.route('**/data*', async (route) => {
      const resposta = await route.fetch();
      const dados = await resposta.json();
      await route.fulfill({
        json: { ...dados, rows: [], meta: { ...dados.meta, projects: [], shown: 0, total: 0 } },
      });
    });
    await page.goto('/');

    await expect(page.getByText('Nenhum projeto escolhido para monitorar.')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await page.getByRole('link', { name: 'Escolher projetos' }).click();
    await expect(page).toHaveURL(/\/settings\/query$/);
    // O desvio de /data ainda pode ter uma consulta em voo ao fim do teste.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('as ferramentas do cabeçalho aparecem também nas configurações', async ({ page }) => {
    await page.goto('/settings/display');

    const ferramentas = page.locator('.ui-page-header .ui-page-tools');
    await expect(ferramentas.getByRole('button', { name: 'Português' })).toBeVisible();
    await expect(ferramentas.getByRole('button', { name: /Mudar para o tema/ })).toBeVisible();
    await expect(ferramentas.getByRole('link', { name: 'Abrir configurações' })).toBeVisible();
  });

  test('o item da seção aberta fica marcado e os das outras não', async ({ page }) => {
    await page.goto('/settings/columns');
    const nav = await openNav(page);

    await expect(nav.getByRole('link', { name: 'Colunas da tabela' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Consulta' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('trocar de seção pelo sidebar leva o foco ao título da seção', async ({ page }) => {
    await page.goto('/settings');
    await goTo(page, 'Colunas da tabela');

    const foco = page.locator('h2[data-focus-target]');
    await expect(foco).toBeFocused();
    await expect(foco).toHaveText('Colunas da tabela');
  });

  test('rolar a casca mantém o sidebar (ou a barra superior) no topo', async ({ page }, info) => {
    // Faz a casca ter o que rolar, qualquer que seja o tamanho do mock.
    await page.evaluate((): void => {
      const main = document.querySelector('.ui-shell__main');
      const espaco = document.createElement('div');
      espaco.style.height = '3000px';
      main?.appendChild(espaco);
    });
    const rolou = await page.evaluate((): number => {
      const casca = document.querySelector('.ui-shell') as HTMLElement;
      casca.scrollTop = 800;
      return casca.scrollTop;
    });
    expect(rolou).toBeGreaterThan(0);
    const fixo = page.locator(info.project.name === 'mobile' ? '.ui-shell__topbar' : '.ui-sidebar');
    const topo = await fixo.evaluate((el): number => el.getBoundingClientRect().top);
    expect(topo).toBe(0);
  });

  test('do Painel, entrar numa seção pelo sidebar leva o foco ao título dela', async ({ page }) => {
    await goTo(page, 'Colunas da tabela');
    await expect(page).toHaveURL(/\/settings\/columns$/);
    const titulo = page.getByRole('heading', { level: 2, name: 'Colunas da tabela' });
    await expect(titulo).toBeFocused();
    await expect(titulo).toHaveAttribute('data-focus-target', '');
  });
});

test.describe('Regras de notificação', () => {
  test.beforeEach(async ({ page }) => {
    await usePreferences(page);
    // Notification de mentira: permissão concedida e cada aviso guardado em
    // window.__avisos, que é o que a jornada lê.
    await page.addInitScript(() => {
      const avisos: { title: string }[] = [];
      (window as unknown as { __avisos: typeof avisos }).__avisos = avisos;
      class Falsa {
        public static permission = 'granted';
        public static requestPermission(): Promise<string> {
          return Promise.resolve('granted');
        }
        public constructor(title: string) {
          avisos.push({ title });
        }
      }
      (window as unknown as { Notification: unknown }).Notification = Falsa;
    });
  });

  const avisos = (page: import('@playwright/test').Page): Promise<string[]> =>
    page.evaluate(() =>
      (window as unknown as { __avisos: { title: string }[] }).__avisos.map((a) => a.title),
    );

  test('desligar o aviso de likes some com o aviso do painel', async ({ page }) => {
    await page.goto('/');
    await expect
      .poll(() => avisos(page))
      .toEqual(['BE #7 recebeu likes', 'BE #199 pipeline falhou']);

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Notificações');
    // O corte geral é um multi-select: as caixas moram no painel dele.
    await page.locator('#notificacoes').getByLabel('Avise quando acontecer').click();
    await page.getByRole('checkbox', { name: 'Likes', exact: true }).uncheck();

    await page.reload();
    await expect.poll(() => avisos(page)).toEqual(['BE #199 pipeline falhou']);
  });

  test('"só o que é meu" deixa só o MR em que estou envolvida', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => avisos(page)).toHaveLength(2);

    await page.getByRole('link', { name: 'Abrir configurações' }).click();
    await goTo(page, 'Notificações');
    await page
      .locator('#notificacoes')
      .getByLabel(/Só o que é meu/)
      .check();

    await page.reload();
    await expect.poll(() => avisos(page)).toEqual(['BE #199 pipeline falhou']);
  });

  test('um critério cala um tipo de aviso e volta inteiro do arquivo', async ({ page }) => {
    await page.goto('/settings/notifications');
    // O catálogo chega por HTTP depois da primeira pintura: o título já
    // traduzido é o sinal de que ele entrou, e só então o texto localiza.
    const titulo = page.getByRole('heading', { level: 2, name: 'Notificações' });
    await expect(titulo).toBeVisible({ timeout: 15_000 });

    // Os critérios só decidem quando são o lado escolhido; com o Geral, não valem.
    await choose(page.getByLabel('Quem decide o que avisar'), 'Critérios de notificação');

    await page.getByRole('button', { name: 'Adicionar regra' }).click();
    const regra = page.locator('.ui-rule-list__rule');
    await expect(regra).toHaveCount(1);

    // "Likes de zero para cima" casa com os DOIS MRs do mock, de propósito:
    // assim quem tem de deixar o aviso de pipeline passar é a lista de tipos
    // da regra, e não a comparação. Ignorar os tipos calaria os dois avisos.
    await choose(regra.getByLabel('Comparação'), 'maior ou igual a');
    await regra.getByLabel('Valor').fill('0');
    await choose(regra.getByLabel('Quando casar'), 'Silenciar');
    await regra.getByLabel('Tipos desta regra').click();
    await regra.getByRole('checkbox', { name: 'Likes', exact: true }).check();
    await page.keyboard.press('Escape');
    // Por último: a regra nasce desligada, e ligá-la antes de preenchida calaria demais.
    const gravado = page.waitForResponse(
      (resposta) =>
        resposta.request().method() === 'POST' &&
        new URL(resposta.url()).pathname === '/preferences',
    );
    await regra.getByRole('checkbox', { name: 'Regra 1' }).check();
    // Espera o fato: a gravação é agrupada por microtask, e recarregar antes
    // dela abortaria a requisição.
    await gravado;

    await page.reload();
    await expect(titulo).toBeVisible();
    await expect(page.getByLabel('Quem decide o que avisar')).toHaveText('Critérios de notificação');
    await expect(regra.getByLabel('Valor')).toHaveValue('0');
    await expect(regra.getByLabel('Quando casar')).toHaveText('Silenciar');
    await expect(regra.getByLabel('Tipos desta regra')).toHaveText('Likes');
    await expect(regra.getByRole('checkbox', { name: 'Regra 1' })).toBeChecked();

    await page.goto('/');
    await expect.poll(() => avisos(page)).toEqual(['BE #199 pipeline falhou']);
  });
});
