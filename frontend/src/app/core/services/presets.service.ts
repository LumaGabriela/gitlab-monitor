import {
  Injectable,
  Signal,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { SortDirection } from '../models/api/panel-api.model';
import { HighlightRule, markStyleOf } from '../rules/rule-engine';
import { ColumnOrderService } from './column-order.service';
import { ColumnVisibilityService } from './column-visibility.service';
import { GitlabMonitorService, REVIEW_FILTER_VALUES } from './gitlab-monitor.service';
import { NotifyRules, NotifyRulesService, parseRules } from './notify-rules.service';
import { PreferencesStore } from './preferences-store.service';
import { RowRulesService, isRule } from './row-rules.service';
import { uniqueId } from './unique-id';

/** `''` em `sort` e `null` nas listas querem dizer "o preset não opina": fica o que a pessoa já tinha. */
export interface PresetFilters {
  readonly sort: string;
  /** Sentido da ordenação, parte da opinião sobre `sort`: só conta quando
   * `sort` opina, e `null` ali é o sentido natural dela. */
  readonly direction: SortDirection | null;
  readonly author: readonly string[] | null;
  readonly pipeline: readonly string[] | null;
  readonly review: readonly string[] | null;
}

/**
 * Um pacote nomeado de preferências de quem olha. Alvos e intervalo ficam
 * de fora de propósito: trocar o alvo recomeça a referência do backend.
 *
 * `null` em `columnOrder`, `hiddenColumns`, `rowRules`, `notifyRules` e nas
 * listas de `filters` quer dizer "este preset não opina": aplicar deixa o que a
 * pessoa já tinha. Lista vazia, ao contrário, é uma opinião (limpar). Os presets prontos
 * só opinam sobre filtros e destaques, para que um clique na barra não apague
 * a ordem das colunas nem as regras de aviso de ninguém.
 */
export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly filters: PresetFilters;
  readonly columnOrder: readonly string[] | null;
  readonly hiddenColumns: readonly string[] | null;
  readonly rowRules: readonly HighlightRule[] | null;
  readonly notifyRules: NotifyRules | null;
}

/** O nome dos prontos é o texto do catálogo `settings.preset-<id>`; `name` guarda só um valor de reserva. */
export const BUILT_IN_PRESETS: readonly Preset[] = [
  {
    id: 'need-review',
    name: 'need-review',
    filters: {
      sort: 'updated',
      direction: null,
      author: [],
      pipeline: [],
      review: ['assigned', 'reviewing'],
    },
    columnOrder: null,
    hiddenColumns: null,
    rowRules: [
      {
        id: 'need-review-1',
        field: 'myReviewState',
        operator: 'eq',
        value: 'unreviewed',
        tone: 'warning',
        markStyle: 'dashed',
        enabled: true,
      },
    ],
    notifyRules: null,
  },
  {
    // O motor não combina regras (a primeira que casa vence), então o E é
    // feito em dois eixos: "depende de mim" é o filtro de revisão, que já
    // reduz a tabela, e "parado" é a regra de destaque dentro dela.
    id: 'my-stuck',
    name: 'my-stuck',
    filters: {
      sort: 'updated',
      direction: null,
      author: [],
      pipeline: [],
      review: ['assigned', 'reviewing'],
    },
    columnOrder: null,
    hiddenColumns: null,
    rowRules: [
      {
        id: 'my-stuck-1',
        field: 'idleHours',
        operator: 'gte',
        value: '72',
        tone: 'danger',
        markStyle: 'solid',
        enabled: true,
      },
    ],
    notifyRules: null,
  },
  {
    // Sem filtro de pipeline: o filtro é lista de inclusão, e enumerar todo
    // estado que não é falha envelheceria a cada estado novo do GitLab.
    id: 'ready-to-merge',
    name: 'ready-to-merge',
    filters: { sort: 'likes', direction: null, author: [], pipeline: [], review: [] },
    columnOrder: null,
    hiddenColumns: null,
    rowRules: [
      {
        id: 'ready-to-merge-1',
        field: 'mergeable',
        operator: 'eq',
        value: 'true',
        tone: 'success',
        markStyle: 'double',
        enabled: true,
      },
    ],
    notifyRules: null,
  },
];

const BUILT_IN_IDS: readonly string[] = BUILT_IN_PRESETS.map((preset) => preset.id);

export function isBuiltInPreset(id: string): boolean {
  return BUILT_IN_IDS.includes(id);
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** A lista podada, ou `null` (mantém o atual) se tinha itens e nenhum sobrou. */
function pruned<T>(list: readonly T[], keep: (item: unknown) => item is T): readonly T[] | null {
  const kept = list.filter(keep);
  return list.length > 0 && kept.length === 0 ? null : kept;
}

function prunedKeys(
  list: readonly string[] | null,
  known: readonly string[],
): readonly string[] | null {
  return list ? pruned(list, (key): key is string => known.includes(key as string)) : null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function sameRules(a: readonly HighlightRule[], b: readonly HighlightRule[]): boolean {
  const shape = (rule: HighlightRule): string =>
    [rule.field, rule.operator, rule.value, rule.tone, markStyleOf(rule), rule.enabled].join('|');
  return sameList(a.map(shape), b.map(shape));
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** Lê um preset guardado campo a campo, como `isRule` faz com as regras: o que
 * o código atual não entende é descartado e o resto vale. Sem id ou nome, não
 * há como o preset ser listado, e ele é descartado inteiro. */
const NOTIFY_KEYS: readonly string[] = [
  'kinds',
  'onlyMine',
  'minLikes',
  'ignoreDrafts',
  'mutedAuthors',
  'quietHours',
  'cooldownMinutes',
  'rules',
];

/** Lista guardada que a leitura poda: `null` (não opina) se não é lista, ou se
 * tinha itens e nenhum sobrou; `[]` só quando o preset a guardou vazia. */
function keptList<T>(raw: unknown, keep: (item: unknown) => item is T): readonly T[] | null {
  if (!Array.isArray(raw)) return null;
  const kept = raw.filter(keep);
  return raw.length > 0 && kept.length === 0 ? null : kept;
}

const isString = (item: unknown): item is string => typeof item === 'string';

function readPreset(item: unknown): Preset | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || raw['id'] === '' || isBuiltInPreset(raw['id'])) return null;
  if (typeof raw['name'] !== 'string' || raw['name'].trim() === '') return null;
  const filters =
    typeof raw['filters'] === 'object' && raw['filters'] !== null
      ? (raw['filters'] as Record<string, unknown>)
      : {};
  const notify = raw['notifyRules'];
  return {
    id: raw['id'],
    name: raw['name'].trim(),
    filters: {
      sort: typeof filters['sort'] === 'string' ? filters['sort'] : '',
      direction:
        filters['direction'] === 'asc' || filters['direction'] === 'desc'
          ? filters['direction']
          : null,
      author: keptList(filters['author'], isString),
      pipeline: keptList(filters['pipeline'], isString),
      review: keptList(
        filters['review'],
        (value): value is string => isString(value) && REVIEW_FILTER_VALUES.includes(value),
      ),
    },
    columnOrder: Array.isArray(raw['columnOrder']) ? stringList(raw['columnOrder']) : null,
    hiddenColumns: Array.isArray(raw['hiddenColumns']) ? stringList(raw['hiddenColumns']) : null,
    rowRules: keptList(raw['rowRules'], isRule),
    notifyRules:
      typeof notify === 'object' &&
      notify !== null &&
      !Array.isArray(notify) &&
      NOTIFY_KEYS.some((key) => key in notify)
        ? parseRules(notify)
        : null,
  };
}

function parsePresets(value: unknown): readonly Preset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const presets: Preset[] = [];
  for (const item of value) {
    const preset = readPreset(item);
    if (preset && !seen.has(preset.id)) {
      seen.add(preset.id);
      presets.push(preset);
    }
  }
  return presets;
}

/**
 * Pacotes de preferências que se aplicam num clique. Só os presets da pessoa
 * são guardados; os prontos moram no código, então um documento corrompido
 * nunca os leva junto.
 *
 * `apply` escreve em cinco serviços, cada um dono da sua preferência. Primeiro
 * decide, só com leituras, o que do preset ainda vale; depois escreve, sem nada
 * que possa lançar no meio (os ids novos não dependem de `crypto.randomUUID`).
 *
 * Regra única por parte: o que não vale mantém o valor atual, em vez de voltar
 * ao padrão. "Não vale" é: ordenação que o backend não oferece, parte que não
 * é do tipo esperado, e lista que tinha itens e ficou vazia depois de podada
 * (regras de campo desconhecido, coluna que sumiu, valor de revisão extinto,
 * regras de aviso sem nenhum campo conhecido). Só uma lista guardada vazia
 * desde o início, `[]`, limpa a preferência.
 */
@Injectable({ providedIn: 'root' })
export class PresetsService {
  private readonly monitor = inject(GitlabMonitorService);
  private readonly columnOrder = inject(ColumnOrderService);
  private readonly columnVisibility = inject(ColumnVisibilityService);
  private readonly rowRules = inject(RowRulesService);
  private readonly notifyRules = inject(NotifyRulesService);
  private readonly store = inject(PreferencesStore);

  private readonly stored: WritableSignal<readonly Preset[]> = signal<readonly Preset[]>(
    parsePresets(this.store.read('presets')),
  );

  /** Ordem e ocultas pedidas por um preset antes de as colunas existirem; valem quando chegarem. */
  private pendingOrder: readonly string[] | null = null;
  private pendingHidden: readonly string[] | null = null;

  public readonly builtIn: readonly Preset[] = BUILT_IN_PRESETS;
  public readonly presets: Signal<readonly Preset[]> = computed((): readonly Preset[] => [
    ...this.builtIn,
    ...this.stored(),
  ]);

  /**
   * O preset cujo conteúdo é exatamente o estado atual, ou vazio. Serve para o
   * seletor da barra não afirmar um preset que a pessoa já desfez à mão.
   */
  public readonly activeId: Signal<string> = computed((): string => {
    const known = this.columnOrder.order();
    const current = {
      sort: this.monitor.sort(),
      direction: this.monitor.sortDirection(),
      author: this.monitor.author(),
      pipeline: this.monitor.pipeline(),
      review: this.monitor.review(),
      rules: this.rowRules.rules(),
      order: known,
      hidden: this.columnVisibility.hidden(),
      notify: JSON.stringify(parseRules(this.notifyRules.rules())),
    };
    const match = this.presets().find((preset): boolean => {
      const filters = preset.filters;
      // O sentido faz parte da ordenação: inverter o cabeçalho à mão desfaz
      // o preset tanto quanto trocar de coluna.
      if (filters.sort && filters.sort !== current.sort) return false;
      if (filters.sort && filters.direction !== current.direction) return false;
      if (filters.author && !sameSet(filters.author, current.author)) return false;
      if (filters.pipeline && !sameSet(filters.pipeline, current.pipeline)) return false;
      if (filters.review && !sameSet(filters.review, current.review)) return false;
      if (preset.rowRules && !sameRules(preset.rowRules, current.rules)) return false;
      if (preset.notifyRules && JSON.stringify(parseRules(preset.notifyRules)) !== current.notify) {
        return false;
      }
      if (preset.columnOrder?.length && known.length) {
        const target = preset.columnOrder.filter((key) => known.includes(key));
        if (!sameList(target, known.slice(0, target.length))) return false;
      }
      if (preset.hiddenColumns && known.length) {
        // Mesma regra do `apply`: sem nenhuma coluna viva, o preset não opina.
        const target = prunedKeys(preset.hiddenColumns, known);
        if (target && !sameSet(target, current.hidden)) return false;
      }
      return true;
    });
    return match?.id ?? '';
  });

  public constructor() {
    // A ordem pedida antes de o backend responder espera aqui: o serviço de
    // ordem só conhece as colunas depois da primeira resposta de /data.
    effect((): void => {
      const known = this.columnOrder.order();
      if (!known.length) return;
      const pendingOrder = this.pendingOrder;
      const pendingHidden = this.pendingHidden;
      this.pendingOrder = null;
      this.pendingHidden = null;
      const order = prunedKeys(pendingOrder, known);
      if (order) this.applyOrder(order);
      const hidden = prunedKeys(pendingHidden, known);
      if (hidden) this.applyHidden(hidden);
    });
  }

  public saveCurrent(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const order = this.columnOrder.order();
    const preset: Preset = {
      id: uniqueId(),
      name: trimmed,
      filters: {
        sort: this.monitor.sort(),
        direction: this.monitor.sortDirection(),
        author: this.monitor.author(),
        pipeline: this.monitor.pipeline(),
        review: this.monitor.review(),
      },
      // Sem colunas registradas (monitor ainda não respondeu) não há ordem a guardar.
      columnOrder: order.length ? order : null,
      hiddenColumns: order.length ? this.columnVisibility.hidden() : null,
      rowRules: this.rowRules.rules(),
      notifyRules: this.notifyRules.rules(),
    };
    this.save([...this.stored(), preset]);
  }

  public apply(id: string): void {
    const preset = this.presets().find((item) => item.id === id);
    if (!preset) return;

    // 1. Decidir, só lendo.
    const rules = preset.rowRules ? pruned(preset.rowRules, isRule) : null;
    const notify = preset.notifyRules ? parseRules(preset.notifyRules) : null;
    const known = this.columnOrder.order();
    // Sem colunas registradas a ordem não pode ser aplicada agora: fica
    // pendente, em vez de se perder em silêncio. Uma aplicação nova a cancela.
    this.pendingOrder = known.length ? null : (preset.columnOrder ?? null);
    const order = known.length ? prunedKeys(preset.columnOrder, known) : null;
    // Idem para as ocultas: podar depois, no serviço de visibilidade, poderia
    // esvaziar o conjunto, e isso seria limpar em vez de manter o atual.
    this.pendingHidden = known.length ? null : (preset.hiddenColumns ?? null);
    const hidden = known.length ? prunedKeys(preset.hiddenColumns, known) : null;
    const sorts = this.monitor.sorts();
    const sort =
      preset.filters.sort &&
      (!sorts.length || sorts.some((item) => item.value === preset.filters.sort))
        ? preset.filters.sort
        : null;
    const direction = preset.filters.direction;
    const author = preset.filters.author;
    const pipeline = preset.filters.pipeline;
    const review = preset.filters.review
      ? pruned(preset.filters.review, (value): value is string =>
          REVIEW_FILTER_VALUES.includes(value as string),
        )
      : null;
    // Ids novos antes de qualquer escrita: nada daqui para baixo pode lançar.
    const added = rules?.map((rule) => ({
      field: rule.field,
      operator: rule.operator,
      value: rule.value,
      tone: rule.tone,
      markStyle: markStyleOf(rule),
      enabled: rule.enabled,
    }));

    // 2. Escrever. Primeiro o que é só local; os filtros por último, porque
    // cada um dispara uma consulta, e só os que mudam.
    if (added) {
      const old = this.rowRules.rules();
      for (const rule of added) this.rowRules.add(rule);
      for (const rule of old) this.rowRules.remove(rule.id);
    }

    if (notify) this.notifyRules.update(notify);
    if (order) this.applyOrder(order);
    if (hidden) this.applyHidden(hidden);

    if (
      sort !== null &&
      (sort !== this.monitor.sort() || direction !== this.monitor.sortDirection())
    ) {
      this.monitor.setSort(sort, direction);
    }
    if (author && !sameList(author, this.monitor.author())) this.monitor.setAuthor(author);
    if (pipeline && !sameList(pipeline, this.monitor.pipeline())) {
      this.monitor.setPipeline(pipeline);
    }
    if (review && !sameList(review, this.monitor.review())) this.monitor.setReview(review);
  }

  /** Só os presets guardados mudam de nome; o pronto tem o nome do catálogo. */
  public rename(id: string, name: string): void {
    // Guarda como foi digitado: o campo da tela reflete o que está guardado, e
    // aparar aqui comeria o espaço no meio da digitação. Ao ler, o nome é aparado.
    if (isBuiltInPreset(id) || !name.trim()) return;
    this.save(this.stored().map((item) => (item.id === id ? { ...item, name } : item)));
  }

  public remove(id: string): void {
    if (isBuiltInPreset(id)) return;
    this.save(this.stored().filter((item) => item.id !== id));
  }

  /** O serviço de ordem só sabe trocar vizinhas: leva cada chave, na ordem
   * pedida, até a sua posição. As que o preset não cita seguem depois, na
   * ordem em que estavam. Lista vazia é "ordem padrão". */
  private applyOrder(target: readonly string[]): void {
    if (!target.length) {
      this.columnOrder.reset();
      return;
    }
    target.forEach((key, position): void => {
      while (this.columnOrder.order().indexOf(key) > position) this.columnOrder.move(key, -1);
    });
  }

  private applyHidden(target: readonly string[]): void {
    for (const key of this.columnVisibility.hidden()) {
      if (!target.includes(key)) this.columnVisibility.setHidden(key, false);
    }
    for (const key of target) {
      if (!this.columnVisibility.isHidden(key)) this.columnVisibility.setHidden(key, true);
    }
  }

  private save(presets: readonly Preset[]): void {
    this.stored.set(presets);
    this.store.write('presets', presets);
  }
}
