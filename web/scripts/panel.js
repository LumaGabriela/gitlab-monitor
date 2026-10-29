const MAX_NOTIFICATIONS = 5;

const panel = {
  since: 0,
  timer: null,
  filters: null,
  node: document.getElementById('table'),
  meta: document.getElementById('meta'),
  warning: document.getElementById('warning'),
  form: document.getElementById('settings'),
  toggle: document.getElementById('notify'),
  hint: document.getElementById('hint'),
  sort: document.getElementById('sort'),
  author: document.getElementById('author'),
  pipeline: document.getElementById('pipeline'),
  reset: document.getElementById('reset'),
  theme: document.getElementById('theme'),
  test: document.getElementById('test-notify'),
  refresh: document.getElementById('refresh'),
  updated: null,
};

// Teto de espera da consulta manual: o ciclo do servidor leva alguns segundos
// e um alvo grande leva mais, mas o botão não pode ficar preso para sempre.
const REFRESH_TIMEOUT = 120000;

function schedule(seconds) {
  clearTimeout(panel.timer);
  // O relógio do navegador acompanha o do servidor: a página busca sozinha.
  panel.timer = setTimeout(poll, Math.max(1, seconds) * 1000);
}

function warn(message) {
  panel.warning.textContent = message || '';
  panel.warning.hidden = !message;
}

// Linha própria: o aviso de permissão não pode ser apagado pela atualização
// da tabela, que roda a cada poucos segundos e limpa a linha de erro.
function hint(message) {
  panel.hint.textContent = message || '';
  panel.hint.hidden = !message;
}

function query() {
  const params = new URLSearchParams({ since: panel.since, sort: panel.sort.value });
  if (panel.author.value) params.set('author', panel.author.value);
  if (panel.pipeline.value) params.set('pipeline', panel.pipeline.value);
  return params.toString();
}

// Reconstrói um select só quando as opções mudam, para não perder a escolha
// nem o foco de quem está mexendo no filtro durante uma atualização.
function syncSelect(select, options, placeholder) {
  const chosen = select.value;
  select.replaceChildren();
  const todos = document.createElement('option');
  todos.value = '';
  todos.textContent = placeholder;
  select.append(todos);
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  }
  // Valor que sumiu da lista volta para "todos", sem filtro fantasma.
  select.value = options.some((option) => option.value === chosen) ? chosen : '';
}

function syncFilters(filters) {
  const signature = JSON.stringify(filters);
  if (signature === panel.filters) return;
  panel.filters = signature;
  syncSelect(panel.author, filters.authors, 'All');
  syncSelect(panel.pipeline, filters.pipelines, 'All');
}

// true quando os eventos foram realmente entregues ao navegador.
function announce(events) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  if (!panel.toggle.checked) return true;
  // Muitos eventos de uma vez viram um aviso só: uma pilha de banners seria
  // pior que a informação que eles trazem.
  if (events.length > MAX_NOTIFICATIONS) {
    new Notification(`${events.length} MR updates`, {
      body: events.map((text) => text.split('\n')[0]).join('\n'),
      tag: 'resumo',
    });
    return true;
  }
  for (const text of events) {
    const lines = text.split('\n');
    // A etiqueta é o evento inteiro: repetir o mesmo aviso substitui o
    // anterior, mas duas mudanças distintas no mesmo MR aparecem as duas.
    new Notification(lines[0], { body: lines.slice(1).join('\n'), tag: text });
  }
  return true;
}

async function poll() {
  try {
    const response = await fetch('data?' + query(), { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status);
    const data = await response.json();
    panel.node.innerHTML = data.table;
    // A tabela (e os <col> dela) é recriada a cada poll: reaplica a largura
    // redistribuída, ou os <col> novos voltam ao tamanho estático em ch.
    redistributeColumnWidths(window.gitlabMonitorHiddenColumns || []);
    panel.meta.textContent = data.meta;
    panel.updated = data.updated;
    warn(data.error);
    syncFilters(data.filters);
    // Enquanto a permissão não chega, os eventos não são consumidos: eles
    // continuam no servidor e são avisados assim que ela for concedida.
    const entregues = !data.events.length || announce(data.events);
    if (entregues || !panel.toggle.checked) panel.since = data.sequence;
    schedule(data.poll);
    return true;
  } catch (error) {
    warn('No response from the monitor. Retrying in 10s.');
    schedule(10);
    return false;
  }
}

const sistemaEscuro = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(escolha) {
  const raiz = document.documentElement;
  raiz.dataset.themeChoice = escolha;
  raiz.dataset.theme = escolha === 'auto'
    ? (sistemaEscuro.matches ? 'dark' : 'light')
    : escolha;
}

panel.theme.value = document.documentElement.dataset.themeChoice || 'auto';

panel.theme.addEventListener('change', () => {
  applyTheme(panel.theme.value);
  try {
    localStorage.setItem('tema', panel.theme.value);
  } catch (erro) {
    // Sem armazenamento, o tema vale só nesta aba.
  }
});

// No automático, acompanhar a troca de tema do sistema sem recarregar.
sistemaEscuro.addEventListener('change', () => {
  if (panel.theme.value === 'auto') applyTheme('auto');
});

for (const select of [panel.sort, panel.author, panel.pipeline]) {
  // Ordenar e filtrar não espera o próximo ciclo: reconsulta na hora.
  select.addEventListener('change', poll);
}

panel.reset.addEventListener('click', () => {
  panel.author.value = '';
  panel.pipeline.value = '';
  poll();
});

// O guia de input pede estado de erro visível no campo, não só na mensagem.
function markInvalid(invalid) {
  for (const campo of [panel.form.project, panel.form.interval]) {
    campo.setAttribute('aria-invalid', String(invalid));
  }
}

panel.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const botao = panel.form.querySelector('button[type="submit"]');
  const payload = {
    project: panel.form.project.value.trim(),
    interval: panel.form.interval.value.trim(),
  };
  botao.disabled = true;
  botao.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    warn(response.ok ? '' : data.error);
    markInvalid(!response.ok);
    if (response.ok) {
      panel.since = 0;
      panel.filters = null;
      poll();
    }
  } catch (error) {
    warn('Could not save: the monitor did not respond.');
  } finally {
    botao.disabled = false;
    botao.removeAttribute('aria-busy');
  }
});

async function requestPermission() {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    hint('');
    poll();
    return true;
  }
  panel.toggle.checked = false;
  hint('Notification permission denied. Review this site’s permission in the browser to turn it back on.');
  return false;
}

panel.toggle.addEventListener('change', async () => {
  if (!panel.toggle.checked) {
    hint('');
    return;
  }
  if (!('Notification' in window)) {
    panel.toggle.checked = false;
    hint('This browser does not offer notifications.');
    return;
  }
  // Marcar a caixa já é o gesto que o navegador exige para pedir permissão.
  await requestPermission();
});

// Consulta sob demanda: não abre uma coleta própria, só encurta a espera do
// ciclo do servidor. Como essa coleta leva alguns segundos, a página espera o
// carimbo da última coleta mudar em vez de supor que terminou com o POST.
panel.refresh.addEventListener('click', async () => {
  const anterior = panel.updated;
  panel.refresh.disabled = true;
  panel.refresh.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(response.status);
    const limite = Date.now() + REFRESH_TIMEOUT;
    while (Date.now() < limite) {
      // Monitor fora do ar: poll já avisou na tela, e insistir não ajuda.
      if (!(await poll())) return;
      if (panel.updated !== anterior) return;
      await new Promise((pronto) => setTimeout(pronto, 1000));
    }
    warn('The manual check took longer than expected; the table updates on its own once it finishes.');
  } catch (error) {
    warn('Could not check now: the monitor did not respond.');
  } finally {
    panel.refresh.disabled = false;
    panel.refresh.removeAttribute('aria-busy');
  }
});

// Silêncio no painel tem duas causas muito diferentes: nada mudou nos MRs, ou
// o aviso saiu daqui e foi engolido depois. Um envio sob demanda separa as
// duas sem esperar que algum MR mude.
panel.test.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    hint('This browser does not offer notifications.');
    return;
  }
  if (Notification.permission === 'denied') {
    hint('Notifications blocked for this site in the browser. Allow the permission to turn it back on.');
    return;
  }
  // O clique é o gesto que o navegador exige para pedir a permissão.
  if (Notification.permission !== 'granted' && !(await requestPermission())) return;
  new Notification('GitLab Monitor', {
    body: 'Test notification: this is how MR changes will show up.',
    tag: 'teste',
  });
  hint('Test notification sent. If nothing appeared on screen, the block is at '
    + 'the system level, not on this page: check the browser’s notifications in '
    + 'the operating system settings and whether Do Not Disturb/Focus is on.');
});

// A caixa vem marcada: o painel tenta deixar as notificações prontas sozinho.
function setupNotifications() {
  if (!('Notification' in window)) {
    panel.toggle.checked = false;
    hint('This browser does not offer notifications.');
    return;
  }
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') {
    panel.toggle.checked = false;
    hint('Notifications blocked for this site in the browser. Allow the permission to turn it back on.');
    return;
  }
  // Permissão ainda não decidida: o navegador só aceita o pedido a partir de
  // um gesto, então o painel espera o primeiro em vez de desistir.
  hint('Browser notifications are on, waiting for your permission: click anywhere on the page to confirm.');
  let pedido = false;
  const pedir = () => {
    if (pedido) return;
    pedido = true;
    requestPermission();
  };
  document.addEventListener('pointerdown', pedir, { once: true });
  document.addEventListener('keydown', pedir, { once: true });
}

// Visibilidade de colunas: columns.js já aplicou o estado salvo antes da
// pintura (window.gitlabMonitorHiddenColumns); aqui sincroniza as checkboxes
// com ele, grava a escolha a cada mudança e redistribui a largura das
// colunas visíveis (ver redistributeColumnWidths abaixo).
const COLUMN_STORAGE_KEY = 'gitlabMonitorHiddenColumns';
const columnToggles = document.querySelectorAll('.columns__toggle');

// Mesmas chaves e larguras em ch de REPORT_COLUMNS/table.css em
// gitlab_monitor.py: mantenha em sincronia.
const COLUMN_WEIGHTS = {
  likes: 10, mr: 36, author: 18, threads: 13, openers: 20, mergeable: 13,
  conflicts: 13, pipeline: 13, updated_label: 18, created_label: 14,
};

function applyHiddenColumns(hidden) {
  let estilo = document.getElementById('column-visibility');
  if (!estilo) {
    estilo = document.createElement('style');
    estilo.id = 'column-visibility';
    document.head.appendChild(estilo);
  }
  // display: none no <col> tira a coluna inteira da contagem de colunas da
  // tabela (como se o <col> não existisse), então não sobra largura
  // reservada nem desalinha o índice das colunas seguintes. "visibility:
  // collapse" e até "width: 0" no <col> já foram tentados e os dois têm o
  // mesmo bug no Chromium: com table-layout: fixed e largura em px no <col>
  // seguinte, a largura da PRÓXIMA coluna visível é atribuída errada (a
  // tabela "desalinha" a partir dali). Como o th/td da coluna some junto
  // (display: none abaixo), o índice continua batendo dos dois lados.
  estilo.textContent = hidden
    .map((chave) => `col.${chave} { display: none !important; }\n`
      + `th.${chave}, td.${chave} { display: none; }`)
    .join('\n');
}

// px por unidade de peso (ch), medido uma vez a partir do próprio layout
// (table.css) e reaproveitado: não muda com o tamanho da janela, só com a
// fonte, que não muda em tempo de execução.
let pxPorPeso = null;

function pesoVisivelTotal(hidden) {
  return Object.keys(COLUMN_WEIGHTS)
    .filter((chave) => !hidden.includes(chave))
    .reduce((soma, chave) => soma + COLUMN_WEIGHTS[chave], 0);
}

// Com "ch" fixo por coluna, ocultar uma coluna sobrava um vão à direita da
// última, porque a soma das larguras visíveis ficava menor que a tabela
// (table { width: 100% }). Aqui a largura de cada coluna visível é
// recalculada em px: se a tabela cabe no espaço disponível, elas esticam
// proporcionalmente até preenchê-lo (sem vão); se não cabe, mantêm o
// tamanho natural e a .table-scroll rola, como antes.
function redistributeColumnWidths(hidden) {
  const tabela = document.querySelector('table');
  const rolagem = document.querySelector('.table-scroll');
  if (!tabela || !rolagem) return;
  if (pxPorPeso === null) {
    // Medida ainda com as larguras estáticas em ch do table.css (nenhuma
    // coluna visível recebeu width inline por este código ainda).
    const pesoAtual = pesoVisivelTotal(window.gitlabMonitorHiddenColumns || []);
    if (!pesoAtual) return;
    pxPorPeso = tabela.getBoundingClientRect().width / pesoAtual;
  }
  const pesoVisivel = pesoVisivelTotal(hidden);
  if (!pesoVisivel) return;
  const larguraNatural = pesoVisivel * pxPorPeso;
  const alvo = Math.max(larguraNatural, rolagem.clientWidth);
  for (const chave of Object.keys(COLUMN_WEIGHTS)) {
    // A coluna oculta não tem <col> gerado (display: none em
    // applyHiddenColumns): não há o que medir nem redistribuir para ela.
    if (hidden.includes(chave)) continue;
    const coluna = tabela.querySelector(`col.${chave}`);
    if (coluna) coluna.style.width = `${(COLUMN_WEIGHTS[chave] / pesoVisivel) * alvo}px`;
  }
}

const hiddenColumns = window.gitlabMonitorHiddenColumns || [];
for (const toggle of columnToggles) {
  toggle.checked = !hiddenColumns.includes(toggle.value);
}
redistributeColumnWidths(hiddenColumns);

for (const toggle of columnToggles) {
  toggle.addEventListener('change', () => {
    const hidden = [...columnToggles]
      .filter((item) => !item.checked)
      .map((item) => item.value);
    window.gitlabMonitorHiddenColumns = hidden;
    applyHiddenColumns(hidden);
    redistributeColumnWidths(hidden);
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(hidden));
    } catch (erro) {
      // Sem armazenamento, a escolha vale só nesta aba.
    }
  });
}

// A tabela é toda recriada a cada poll (innerHTML): os <col> novos voltam à
// largura estática em ch até serem redistribuídos de novo. O tamanho da
// janela também pode mudar o espaço disponível a qualquer momento.
window.addEventListener('resize', () => redistributeColumnWidths(window.gitlabMonitorHiddenColumns || []));

setupNotifications();
poll();
