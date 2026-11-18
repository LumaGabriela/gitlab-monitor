// O vocabulário que o mock copia do gitlab_monitor.py: colunas, ordenações,
// filtros de revisão e o valor do MR sem pipeline.
//
// Mora num módulo próprio, e não dentro do monitor-mock.mjs, para o gate
// `scripts/check-mock-contract.test.mjs` poder compará-lo com o Python sem
// subir servidor nenhum. Quando o backend muda uma destas listas, o gate
// reprova e este arquivo é o único a mudar.

// cell e weight são os mesmos de REPORT_COLUMNS: o painel desenha o que /data
// descreve, então errar aqui é testar uma tabela que não existe.
export const COLUMNS = [
  { key: 'likes', label: 'Likes', cell: 'likes', weight: 10 },
  { key: 'mr', label: 'MR', cell: 'link', weight: 50 },
  { key: 'author', label: 'Autor', cell: 'text', weight: 18 },
  { key: 'threads', label: 'Threads', cell: 'badge', weight: 13 },
  { key: 'openers', label: 'Participantes', cell: 'text', weight: 20 },
  { key: 'review', label: 'Revisão', cell: 'people', weight: 16 },
  { key: 'mergeable', label: 'Mergeável', cell: 'badge', weight: 13 },
  { key: 'conflicts', label: 'Conflitos', cell: 'badge', weight: 13 },
  { key: 'pipeline', label: 'Pipeline', cell: 'badge', weight: 13 },
  { key: 'updated_label', label: 'Atualizado', cell: 'time', weight: 18 },
  { key: 'created_label', label: 'Criado', cell: 'text', weight: 14 },
];

// column e direction são o que liga a ordenação à coluna, como no
// gitlab_monitor.py: é por eles que a seta sabe em qual cabeçalho aparecer.
// A ordem importa: uma chave guardada que não existe mais cai na primeira.
// `direction` é o sentido NATURAL, o que vale sem ninguém pedir outro: o
// cabeçalho inverte pedindo `direction` na consulta. O rótulo nomeia a coluna,
// não um sentido, senão mentiria metade do tempo.
export const SORTS = [
  { value: 'recent', label: 'Criado', column: 'created_label', direction: 'desc' },
  { value: 'updated', label: 'Atualizado', column: 'updated_label', direction: 'desc' },
  { value: 'likes', label: 'Likes', column: 'likes', direction: 'desc' },
  { value: 'mr', label: 'MR', column: 'mr', direction: 'asc' },
  { value: 'author', label: 'Autor', column: 'author', direction: 'asc' },
  { value: 'threads', label: 'Threads', column: 'threads', direction: 'desc' },
  { value: 'participants', label: 'Participantes', column: 'openers', direction: 'asc' },
  { value: 'pipeline', label: 'Pipeline', column: 'pipeline', direction: 'asc' },
];

/** Os dois sentidos que a consulta aceita, como DIRECTIONS do Python. */
export const DIRECTIONS = ['asc', 'desc'];

/** O valor que o backend usa para o MR sem pipeline nenhuma. */
export const NO_PIPELINE = 'no-pipeline';

// O teto de alvos que o POST /settings aceita, como MAX_TARGETS do Python.
export const MAX_TARGETS = 20;

// Mesmas regras do REVIEW_FILTERS do gitlab_monitor.py.
export const REVIEW_FILTERS = {
  assigned: (item) => item.facts.assignedToMe,
  reviewing: (item) => item.facts.reviewingMine,
  unassigned: (item) => item.facts.assignees === 0 && item.facts.reviewers === 0,
};

// As opções que o /data oferece. No servidor elas saem das linhas coletadas;
// aqui são fixas, e incluem o MR sem pipeline de propósito: é o valor cuja
// grafia já mudou uma vez (`sem-pipeline`), e sem ele nas opções a poda de
// filtro guardado nunca é exercitada de ponta a ponta.
export const PIPELINE_OPTIONS = [
  { value: 'success', label: 'sucesso' },
  { value: 'failed', label: 'falhou' },
  { value: NO_PIPELINE, label: 'sem pipeline' },
];
