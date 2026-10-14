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
  syncSelect(panel.author, filters.authors, 'Todos');
  syncSelect(panel.pipeline, filters.pipelines, 'Todas');
}

// true quando os eventos foram realmente entregues ao navegador.
function announce(events) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  if (!panel.toggle.checked) return true;
  // Muitos eventos de uma vez viram um aviso só: uma pilha de banners seria
  // pior que a informação que eles trazem.
  if (events.length > MAX_NOTIFICATIONS) {
    new Notification(`${events.length} atualizações nos MRs`, {
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
    warn('Sem resposta do monitor. Nova tentativa em 10s.');
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
    warn('Não foi possível salvar: o monitor não respondeu.');
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
  hint('Permissão de notificação negada. Reveja a permissão deste site no navegador para reativar.');
  return false;
}

panel.toggle.addEventListener('change', async () => {
  if (!panel.toggle.checked) {
    hint('');
    return;
  }
  if (!('Notification' in window)) {
    panel.toggle.checked = false;
    hint('Este navegador não oferece notificações.');
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
    warn('A consulta manual demorou mais que o esperado; a tabela se atualiza sozinha quando ela terminar.');
  } catch (error) {
    warn('Não foi possível consultar agora: o monitor não respondeu.');
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
    hint('Este navegador não oferece notificações.');
    return;
  }
  if (Notification.permission === 'denied') {
    hint('Notificações bloqueadas para este site no navegador. Libere a permissão para reativar.');
    return;
  }
  // O clique é o gesto que o navegador exige para pedir a permissão.
  if (Notification.permission !== 'granted' && !(await requestPermission())) return;
  new Notification('GitLab Monitor', {
    body: 'Notificação de teste: é assim que as mudanças nos MRs vão aparecer.',
    tag: 'teste',
  });
  hint('Notificação de teste enviada. Se nada apareceu na tela, o bloqueio está '
    + 'no sistema, não nesta página: verifique as notificações do navegador nos '
    + 'ajustes do sistema operacional e se o Não Perturbe/Foco está ligado.');
});

// A caixa vem marcada: o painel tenta deixar as notificações prontas sozinho.
function setupNotifications() {
  if (!('Notification' in window)) {
    panel.toggle.checked = false;
    hint('Este navegador não oferece notificações.');
    return;
  }
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') {
    panel.toggle.checked = false;
    hint('Notificações bloqueadas para este site no navegador. Libere a permissão para reativar.');
    return;
  }
  // Permissão ainda não decidida: o navegador só aceita o pedido a partir de
  // um gesto, então o painel espera o primeiro em vez de desistir.
  hint('Notificações do navegador ligadas, aguardando sua permissão: clique em qualquer lugar da página para confirmar.');
  let pedido = false;
  const pedir = () => {
    if (pedido) return;
    pedido = true;
    requestPermission();
  };
  document.addEventListener('pointerdown', pedir, { once: true });
  document.addEventListener('keydown', pedir, { once: true });
}

setupNotifications();
poll();
