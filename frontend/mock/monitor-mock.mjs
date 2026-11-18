// Monitor de mentira: responde /data, /settings, /preferences e /refresh com o mesmo
// contrato do gitlab_monitor.py, para as jornadas rodarem sem GitLab, sem
// token e sem o seu .env.
//
// O formato aqui é o que panel_snapshot/serialize_row produzem; se um deles
// mudar, este arquivo muda junto — é o preço de testar sem o servidor real,
// e o que evita uma suíte que depende da rede de terceiros.
//
// O vocabulário (colunas, ordenações, filtros) mora em monitor-contract.mjs,
// e `scripts/check-mock-contract.test.mjs` o compara com o Python: mock que
// descola do backend reprova o gate em vez de silenciosamente deixar de
// cobrir o que parece cobrir.
import { createServer } from 'node:http';
import {
  COLUMNS,
  DIRECTIONS,
  MAX_TARGETS,
  NO_PIPELINE,
  PIPELINE_OPTIONS,
  REVIEW_FILTERS,
  SORTS,
} from './monitor-contract.mjs';

function row(
  {
    iid,
    title,
    author,
    likes,
    mine,
    involved,
    pipeline,
    tone,
    status,
    changed = [],
    idleHours = 2,
    assignedToMe = false,
    reviewingMine = false,
    myReviewState = '',
    assignees = 0,
    reviewers = 0,
  },
  likesHighlight,
) {
  return {
    cells: {
      likes: {
        label: String(likes),
        // Mesma regra do serialize_row: quem decide o tom é o backend, a
        // partir do limite que o painel informa. Zero não destaca nada.
        tone: likesHighlight && likes >= likesHighlight ? 'strong' : null,
        icon: 'likes',
        mine,
        likers: likes ? ['ana.lima'] : [],
      },
      mr: { label: `BE #${iid} ${title}`, url: `https://gitlab.example/mr/${iid}` },
      author: { label: author },
      threads: { label: '1/2 resolvidas', tone: 'warning', icon: 'threads', resolved: 1, total: 2 },
      openers: { label: 'heloysa.uchoa', names: ['heloysa.uchoa'] },
      review: {
        label: assignedToMe ? 'geovana.medeiros · luma.silva' : '—',
        names: assignedToMe ? ['geovana.medeiros', 'luma.silva'] : [],
        tone: myReviewState === 'unreviewed' ? 'warning' : null,
        state: myReviewState,
      },
      mergeable: { label: 'mergeável', tone: 'success', value: true },
      conflicts: { label: 'sem conflito', tone: null, value: false },
      pipeline: { label: pipeline, tone, status },
      // Os valores crus (iso, status, contagens) vão ao lado do rótulo, como no
      // serialize_row: o painel reformata no idioma ativo.
      updated_label: {
        label: 'há 2 horas',
        title: '2026-11-16T10:00:00Z',
        iso: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      },
      created_label: { label: '01/10/2026', iso: '2026-10-01T10:00:00Z' },
    },
    changed,
    // Mesmos campos do serialize_row: o que as regras de destaque comparam.
    facts: {
      likes,
      unresolved: 1,
      participants: 1,
      mergeable: true,
      conflicts: false,
      pipeline: status,
      author,
      mine,
      involved,
      draft: false,
      ageHours: 24 * 46,
      idleHours,
      assignedToMe,
      reviewingMine,
      myReviewState,
      assignees,
      reviewers,
    },
  };
}

const BASE_ROWS = [
  {
    iid: 199,
    title: 'ajusta o contrato da tabela',
    author: 'geovana.medeiros',
    likes: 2,
    mine: true,
    involved: true,
    pipeline: 'sucesso',
    tone: 'success',
    status: 'success',
    changed: ['pipeline'],
    assignedToMe: true,
    myReviewState: 'unreviewed',
    assignees: 1,
    reviewers: 1,
  },
  {
    iid: 7,
    title: 'corrige o filtro de autores',
    author: 'ana.lima',
    likes: 0,
    mine: false,
    involved: false,
    pipeline: 'falhou',
    tone: 'danger',
    status: 'failed',
    idleHours: 80,
  },
];

// Alvos que o monitor de verdade lista (GET /projects): grupos primeiro, depois
// projetos, cada grupo em ordem alfabética do rótulo. `value` é a forma
// canônica de project_path (projeto escapado, grupo prefixado).
const AVAILABLE_TARGETS = [
  { value: 'groups/grupo', label: 'grupo', kind: 'group' },
  { value: 'grupo%2Fprojeto', label: 'grupo/projeto', kind: 'project' },
  { value: 'grupo%2Foutro', label: 'grupo/outro', kind: 'project' },
];
let targets = ['grupo%2Fprojeto'];
let interval = 15;
// Documento de preferências em memória: some ao reiniciar o mock, como o
// README explica. O backend de verdade o guarda em user-data/preferences.json.
let preferences = {};

const EVENTO_BASE = {
  title: 'Ajusta o filtro',
  author: 'ana.lima',
  likes: 2,
  mine: true,
  involved: true,
  draft: false,
};
const EVENTOS = [
  {
    ...EVENTO_BASE,
    kind: 'likes',
    // O MR 7 não é meu nem participo: o filtro "só o que é meu" o descarta.
    mine: false,
    involved: false,
    mr: '7',
    text: 'BE #7 recebeu likes\nana.lima',
    url: 'https://gitlab.example/mr/7',
  },
  {
    ...EVENTO_BASE,
    kind: 'pipeline',
    mr: '199',
    text: 'BE #199 pipeline falhou\nana.lima',
    url: 'https://gitlab.example/mr/199',
  },
];

/** O rótulo do alvo, sem escape, como o monitor o mostra em meta.projects.
 * É o `unquote` do Python e nada mais: o prefixo `groups/` continua no rótulo
 * de um grupo, e o `label` de /projects (o full_path, sem prefixo) é outra
 * coisa. Devolver o `label` aqui faria o mock mentir sobre grupos. */
function rotulo(value) {
  return decodeURIComponent(value);
}

/** A ordenação acontece no servidor, como no monitor de verdade; `direction`
 * diferente do sentido natural sai invertida, como no arrange() do Python. */
function ordenar(linhas, sort, direction) {
  const opcao = SORTS.find((item) => item.value === sort);
  if (!opcao) return linhas;
  const invertida = DIRECTIONS.includes(direction) && direction !== opcao.direction;
  if (opcao.value === 'recent') return invertida ? [...linhas].reverse() : linhas;
  const sinal = (opcao.direction === 'asc' ? 1 : -1) * (invertida ? -1 : 1);
  return [...linhas].sort((a, b) => {
    const x = a.cells[opcao.column].label;
    const y = b.cells[opcao.column].label;
    const numerico = Number(x) - Number(y);
    return (
      sinal * (Number.isNaN(numerico) ? String(x).localeCompare(String(y), 'pt-BR') : numerico)
    );
  });
}

function snapshot(query) {
  const likesHighlight = Number(query.get('likes') ?? 0) || 0;
  const todas = ordenar(
    BASE_ROWS.map((item) => row(item, likesHighlight)),
    query.get('sort') ?? 'recent',
    query.get('direction') ?? '',
  );
  const authors = query.getAll('author');
  // OU entre os valores, como no servidor; desconhecido é ignorado.
  const review = query.getAll('review').filter((value) => Object.hasOwn(REVIEW_FILTERS, value));
  // O MR sem pipeline entra como NO_PIPELINE, como no arrange() do Python.
  const pipelines = query.getAll('pipeline');
  const rows = todas
    .filter((item) => !authors.length || authors.includes(item.cells.author.label))
    .filter(
      (item) => !pipelines.length || pipelines.includes(item.cells.pipeline.status || NO_PIPELINE),
    )
    .filter((item) => !review.length || review.some((value) => REVIEW_FILTERS[value](item)));
  const filtrado = authors.length > 0 || pipelines.length > 0 || review.length > 0;
  return {
    rows,
    collected: true,
    emptyMessage: rows.length
      ? null
      : filtrado
        ? { key: 'empty-filter', label: 'Nenhum MR corresponde aos filtros.' }
        : { key: 'empty-target', label: 'Nenhum MR aberto para este alvo.' },
    columns: COLUMNS,
    sorts: SORTS,
    meta: {
      projects: targets.map(rotulo),
      // A forma canônica, com que o painel reconcilia a escolha guardada.
      targets,
      // O mock nunca falha por alvo; a chave existe porque o contrato a tem.
      failed: [],
      interval,
      shown: rows.length,
      total: todas.length,
      updated: '2026-11-16T10:00:00Z',
    },
    filters: {
      authors: [
        { value: 'geovana.medeiros', label: 'geovana.medeiros' },
        { value: 'ana.lima', label: 'ana.lima' },
      ],
      pipelines: PIPELINE_OPTIONS,
    },
    error: null,
    // Dois eventos de tipos diferentes, entregues só a quem ainda não os viu
    // (`since` zero), como o servidor: é o que as jornadas de aviso usam.
    events: Number(query.get('since') ?? 0) < 1 ? EVENTOS : [],
    sequence: 1,
    updated: '2026-11-16T10:00:00Z',
    // Alto de propósito: sem isso o painel consultaria a cada 10s durante o
    // teste e disputaria o DOM com as asserções.
    poll: 3600,
  };
}

function body(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const port = Number(process.env['MOCK_PORT'] ?? 8791);

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  const send = (status, payload) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  };

  if (url.pathname === '/data') return send(200, snapshot(url.searchParams));
  if (url.pathname === '/projects') return send(200, { targets: AVAILABLE_TARGETS });
  if (url.pathname === '/settings') {
    const payload = await body(request);
    // Como apply_settings: `project` singular não vale mais; duplicata some
    // preservando a ordem.
    // O `code` acompanha a mensagem, como no apply_settings: é por ele que o
    // painel escolhe o texto no catálogo.
    if (!Array.isArray(payload.projects) || payload.projects.length === 0) {
      return send(400, { error: 'Provide at least one project or group.', code: 'no-targets' });
    }
    const escolhidos = [...new Set(payload.projects)];
    if (escolhidos.length > MAX_TARGETS) {
      return send(400, {
        error: `Choose at most ${MAX_TARGETS} projects or groups.`,
        code: 'too-many-targets',
      });
    }
    targets = escolhidos;
    interval = Number(payload.interval) || interval;
    return send(200, {});
  }
  if (url.pathname === '/preferences') {
    if (request.method === 'POST') {
      const payload = await body(request);
      if (
        payload.version !== 1 ||
        typeof payload.preferences !== 'object' ||
        !payload.preferences
      ) {
        return send(400, { error: 'Documento de preferências inválido.' });
      }
      preferences = payload.preferences;
      return send(200, { version: 1, preferences });
    }
    return send(200, { version: 1, preferences, file: 'user-data/preferences.json' });
  }
  if (url.pathname === '/refresh') return send(200, {});
  return send(404, { error: 'rota inexistente no mock' });
}).listen(port, () => console.log(`monitor-mock em http://localhost:${port}`));
