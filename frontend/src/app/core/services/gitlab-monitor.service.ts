import { HttpParams } from '@angular/common/http';
import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import {
  AvailableTargetModel,
  ColumnModel,
  LabeledValueModel,
  PanelEventModel,
  PanelFiltersModel,
  PanelMetaModel,
  PanelSnapshotModel,
  SettingsResponseModel,
  SortDirection,
  SortOptionModel,
  TargetsResponseModel,
  MrRowModel,
} from '../models/api/panel-api.model';
import { BaseService } from './base.service';
import { PreferencesStore } from './preferences-store.service';

const EMPTY_SNAPSHOT: PanelSnapshotModel = {
  rows: [],
  collected: false,
  emptyMessage: null,
  columns: [],
  sorts: [],
  meta: { projects: [], targets: [], failed: [], interval: 0, shown: 0, total: 0, updated: null },
  filters: { authors: [], pipelines: [] },
  error: null,
  events: [],
  sequence: 0,
  updated: null,
  poll: 10,
};

/** Teto da consulta manual: o ciclo do servidor leva alguns segundos, mas o
 * botão não pode ficar preso para sempre. */
const REFRESH_TIMEOUT_MS = 120_000;

/** Espera entre duas verificações enquanto a consulta manual não termina. */
const REFRESH_POLL_MS = 1_000;

/** Intervalo de nova tentativa quando o monitor não responde, em segundos. */
const RETRY_SECONDS = 10;

/**
 * Quanto tempo uma coleta precisa estar em andamento para valer dizer que o
 * painel está coletando. O ciclo normal responde em poucos milissegundos, e
 * sem esse limiar o ícone piscaria a cada volta de dez segundos sem comunicar
 * nada; meio segundo fica abaixo do limite em que a espera passa a incomodar
 * e acima de uma resposta normal do monitor local.
 */
export const COLLECTING_HINT_MS = 500;

/** Os três valores que o backend aceita em `review`. Fixos: o filtro é
 * relacional a quem olha, não uma propriedade da linha, então não há o que
 * derivar dos dados como se faz com autor e pipeline. */
export const REVIEW_FILTER_VALUES: readonly string[] = ['assigned', 'reviewing', 'unassigned'];

/** Intervalo de coleta padrão, em minutos. Cópia do DEFAULT_INTERVAL do
 * gitlab_monitor.py, com gate em `scripts/check-backend-constants.test.mjs`. */
const DEFAULT_INTERVAL = 15;

/** Quantos alvos o backend aceita de uma vez. Cópia do MAX_TARGETS do
 * gitlab_monitor.py, com o mesmo gate. */
export const MAX_TARGETS = 20;

interface StoredFilters {
  readonly sort: string;
  /** Sentido pedido à mão pelo cabeçalho; `null` é o natural da ordenação. */
  readonly direction: SortDirection | null;
  readonly author: readonly string[];
  readonly pipeline: readonly string[];
  readonly review: readonly string[];
}

/** Falha que a tela mostra: uma CHAVE de tradução, nunca o texto pronto,
 * exceto quando a mensagem vem do próprio backend. */
export interface MonitorWarning {
  readonly key: string;
  readonly text: string | null;
  /** Valores de interpolação da chave, quando ela os tem. */
  readonly params?: Readonly<Record<string, string>>;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Os alvos guardados no arquivo, com a MESMA regra do `preferred_targets` do
 * Python: tudo-ou-nada. O arquivo é editável à mão, e sobre ele o Python é a
 * autoridade — ele é quem decide o que o monitor consulta. Filtrar item a item
 * aqui mostraria caixas marcadas para alvos que o monitor não está
 * consultando. Item que não é texto, lista acima do teto: a preferência
 * inteira cai, como lá.
 */
function storedTargets(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_TARGETS) return [];
  const todos = value.every(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  );
  return todos ? [...new Set(value as readonly string[])] : [];
}

/** A partir de quantos likes o selo ganha destaque. Zero desliga: é o padrão
 * porque o que conta como "muitos likes" muda de time para time. */
function parseLikesHighlight(value: unknown): number {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** Intervalo de coleta, em minutos. O backend aceita qualquer número positivo
 * (0,5 inclusive), então a fração se mantém; inválido cai no padrão. */
function parseInterval(value: unknown): number {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL;
}

/**
 * O aviso que a última coleta deixou. A falha total vem com o texto do
 * backend; a parcial não vem como erro nenhum — o ciclo terminou, mas sem as
 * linhas dos alvos que não responderam, e sem este aviso a faixa ficaria
 * verde mostrando menos MRs do que existem.
 */
function snapshotWarning(data: PanelSnapshotModel): MonitorWarning | null {
  if (data.error) return { key: '', text: data.error };
  if (!data.meta.failed.length) return null;
  return {
    key: 'monitor.partial-failure',
    text: null,
    params: { projects: data.meta.failed.join(', ') },
  };
}

/**
 * A recusa do `POST /settings`. O backend manda um `code` ao lado da mensagem,
 * e é o catálogo que decide o texto: a mensagem dele é inglês de servidor, e o
 * painel pode estar em pt-BR. O texto só é usado como reserva, e por isso vem
 * junto da chave.
 */
function settingsWarning(error: unknown): MonitorWarning {
  const body = (error as { error?: unknown })?.error as SettingsResponseModel | undefined;
  const code = typeof body?.code === 'string' ? body.code : '';
  const text = typeof body?.error === 'string' && body.error ? body.error : null;
  if (code) return { key: `settings.error-${code}`, text };
  return text ? { key: '', text } : { key: 'settings.save-failed', text: null };
}

function parseFilters(value: unknown): StoredFilters {
  const fallback: StoredFilters = {
    sort: 'recent',
    direction: null,
    author: [],
    pipeline: [],
    review: [],
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const parsed = value as Partial<StoredFilters>;
  return {
    sort: typeof parsed.sort === 'string' ? parsed.sort : fallback.sort,
    // Sentido fora dos dois conhecidos é o natural, não um erro que derruba
    // o resto dos filtros.
    direction: parsed.direction === 'asc' || parsed.direction === 'desc' ? parsed.direction : null,
    author: stringList(parsed.author),
    pipeline: stringList(parsed.pipeline),
    // As três opções são fixas, então um valor desconhecido já se descarta
    // na leitura, antes da primeira consulta.
    review: stringList(parsed.review).filter((item) => REVIEW_FILTER_VALUES.includes(item)),
  };
}

/**
 * Estado do painel: consulta /data em ciclo, guarda ordenação e filtros e
 * encaminha as mudanças a quem notifica.
 */
@Injectable({ providedIn: 'root' })
export class GitlabMonitorService extends BaseService {
  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly storedFilters: StoredFilters = parseFilters(this.store.read('filters'));

  private readonly state: WritableSignal<PanelSnapshotModel> =
    signal<PanelSnapshotModel>(EMPTY_SNAPSHOT);
  private readonly warningState: WritableSignal<MonitorWarning | null> =
    signal<MonitorWarning | null>(null);
  private readonly sortState: WritableSignal<string> = signal<string>(this.storedFilters.sort);
  private readonly directionState: WritableSignal<SortDirection | null> =
    signal<SortDirection | null>(this.storedFilters.direction);
  private readonly authorState: WritableSignal<readonly string[]> = signal<readonly string[]>(
    this.storedFilters.author,
  );
  private readonly pipelineState: WritableSignal<readonly string[]> = signal<readonly string[]>(
    this.storedFilters.pipeline,
  );
  private readonly reviewState: WritableSignal<readonly string[]> = signal<readonly string[]>(
    this.storedFilters.review,
  );
  private readonly likesHighlightState: WritableSignal<number> = signal<number>(
    parseLikesHighlight(this.store.read('likesHighlight')),
  );
  private readonly targetsState: WritableSignal<readonly string[]> = signal<readonly string[]>(
    storedTargets(this.store.read('monitoredProjects')),
  );
  private readonly savingState: WritableSignal<boolean> = signal<boolean>(false);
  private readonly refreshingState: WritableSignal<boolean> = signal<boolean>(false);
  private readonly collectingState: WritableSignal<boolean> = signal<boolean>(false);

  public readonly snapshot: Signal<PanelSnapshotModel> = this.state.asReadonly();
  public readonly warning: Signal<MonitorWarning | null> = this.warningState.asReadonly();
  public readonly sort: Signal<string> = this.sortState.asReadonly();
  /** Sentido pedido à mão; `null` quando vale o natural da ordenação em uso. */
  public readonly sortDirection: Signal<SortDirection | null> = this.directionState.asReadonly();
  public readonly author: Signal<readonly string[]> = this.authorState.asReadonly();
  public readonly pipeline: Signal<readonly string[]> = this.pipelineState.asReadonly();
  public readonly review: Signal<readonly string[]> = this.reviewState.asReadonly();
  public readonly likesHighlight: Signal<number> = this.likesHighlightState.asReadonly();
  /** A escolha em vigor: os alvos (forma canônica) que o monitor consulta.
   * Nasce do arquivo de preferências e passa a ser o que `/data` informa. */
  public readonly targets: Signal<readonly string[]> = this.targetsState.asReadonly();
  public readonly saving: Signal<boolean> = this.savingState.asReadonly();
  public readonly refreshing: Signal<boolean> = this.refreshingState.asReadonly();
  /** Coleta do ciclo normal em andamento há mais que `COLLECTING_HINT_MS`. */
  public readonly collecting: Signal<boolean> = this.collectingState.asReadonly();

  public readonly rows: Signal<readonly MrRowModel[]> = computed(() => this.state().rows);
  public readonly columns: Signal<readonly ColumnModel[]> = computed(() => this.state().columns);
  public readonly sorts: Signal<readonly SortOptionModel[]> = computed(() => this.state().sorts);
  public readonly filters: Signal<PanelFiltersModel> = computed(() => this.state().filters);
  public readonly meta: Signal<PanelMetaModel> = computed(() => this.state().meta);

  private since = 0;
  /** Numera as consultas: só a última a sair pode escrever o estado. */
  private pollTicket = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private collectingTimer: ReturnType<typeof setTimeout> | null = null;
  private onEvents: ((events: readonly PanelEventModel[]) => boolean) | null = null;

  /**
   * Como entregar os eventos de mudança. Sem isso, poll() trata todo evento
   * como entregue e só avança o `since` — o aviso se perderia em silêncio.
   */
  public registerEventSink(handler: (events: readonly PanelEventModel[]) => boolean): void {
    this.onEvents = handler;
  }

  public start(): void {
    void this.poll();
  }

  /**
   * Troca a ordenação. Sem `direction`, vale o sentido natural dela: escolher
   * outra coluna recomeça no sentido que o backend declara, e só clicar de
   * novo no mesmo cabeçalho pede o contrário.
   */
  public setSort(value: string, direction: SortDirection | null = null): void {
    this.sortState.set(value);
    this.directionState.set(direction);
    this.persistFilters();
    void this.poll();
  }

  public setAuthor(value: readonly string[]): void {
    this.authorState.set(value);
    this.persistFilters();
    void this.poll();
  }

  public setPipeline(value: readonly string[]): void {
    this.pipelineState.set(value);
    this.persistFilters();
    void this.poll();
  }

  public setReview(value: readonly string[]): void {
    this.reviewState.set(value);
    this.persistFilters();
    void this.poll();
  }

  /** Quem decide o tom da célula continua sendo o backend: isto é a
   * preferência, e vai na consulta como os filtros. */
  public setLikesHighlight(value: number): void {
    const limite = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    this.likesHighlightState.set(limite);
    this.store.write('likesHighlight', limite);
    void this.poll();
  }

  public resetFilters(): void {
    this.authorState.set([]);
    this.pipelineState.set([]);
    this.reviewState.set([]);
    this.persistFilters();
    void this.poll();
  }

  /**
   * Os projetos e grupos que a pessoa pode escolher. A falha sobe para quem
   * chamou: a tela precisa distinguir "a lista falhou" de "não há projetos".
   */
  public async loadTargets(): Promise<readonly AvailableTargetModel[]> {
    const response = await this.get<TargetsResponseModel>('panelTargets');
    return response.targets;
  }

  /**
   * Só o que o backend aceita vira preferência: gravar antes deixaria a
   * escolha guardada diferente do que o monitor de fato consulta.
   *
   * Devolve `null` quando deu certo e, quando não, a falha — para a tela em
   * que a pessoa clicou Salvar mostrá-la. O aviso do Painel não serve aqui:
   * quem salvou está em `/settings/query` e não veria nada.
   */
  public async saveSettings(
    projects: readonly string[],
    interval: string,
  ): Promise<MonitorWarning | null> {
    this.savingState.set(true);
    try {
      await this.post<SettingsResponseModel>('panelSettings', { projects, interval });
      this.targetsState.set(projects);
      this.store.write('monitoredProjects', projects);
      this.since = 0;
      this.warningState.set(null);
      const before = this.state();
      await this.poll();
      // O backend é quem sabe o que aceitou: guarda o intervalo que ele ecoa
      // em `meta`, e não o texto digitado passado por um parser nosso. Mas só
      // vale o eco de um snapshot que esta consulta trouxe: se ela falhou ou
      // foi superada, o estado é o anterior ao salvamento, com o intervalo
      // antigo. Aí cai no texto, que o backend já aceitou.
      const fresh = this.state() !== before;
      const accepted = fresh ? this.state().meta.interval : parseInterval(interval);
      this.store.write('interval', accepted);
      return null;
    } catch (error: unknown) {
      return settingsWarning(error);
    } finally {
      this.savingState.set(false);
    }
  }

  /**
   * Pede uma coleta agora e espera a tabela mudar. O servidor não avisa
   * quando terminou: o que indica o fim é o `updated` virar outro.
   */
  public async refreshNow(): Promise<void> {
    const previousUpdate = this.state().updated;
    this.refreshingState.set(true);
    try {
      await this.post<void>('panelRefresh');
      const deadline = Date.now() + REFRESH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const ok = await this.poll();
        if (!ok) return;
        if (this.state().updated !== previousUpdate) return;
        await new Promise((resolve) => setTimeout(resolve, REFRESH_POLL_MS));
      }
      this.warningState.set({ key: 'monitor.refresh-slow', text: null });
    } catch {
      this.warningState.set({ key: 'monitor.refresh-failed', text: null });
    } finally {
      this.refreshingState.set(false);
    }
  }

  private async poll(): Promise<boolean> {
    this.clearTimer();
    // Trocar vários filtros em sequência (um preset, por exemplo) dispara uma
    // consulta por troca, e as respostas podem chegar fora de ordem: a de uma
    // consulta já superada deixaria a tabela mostrando filtros que não são os
    // dos controles. Descartada, ela também não adianta `since` nem entrega
    // eventos; a consulta mais recente, com o mesmo `since`, traz tudo.
    const ticket = ++this.pollTicket;
    this.markCollecting();
    let params = new HttpParams()
      .set('since', String(this.since))
      .set('sort', this.sortState())
      .set('likes', String(this.likesHighlightState()));
    // Só vai quando o sentido foi pedido: sem o parâmetro, o backend usa o
    // natural, e é ele que vale depois de trocar de coluna.
    const direction = this.directionState();
    if (direction) params = params.set('direction', direction);
    for (const value of this.authorState()) params = params.append('author', value);
    for (const value of this.pipelineState()) params = params.append('pipeline', value);
    for (const value of this.reviewState()) params = params.append('review', value);

    try {
      const data = await this.get<PanelSnapshotModel>('panelData', params);
      if (ticket !== this.pollTicket) return true;
      this.state.set(data);
      // A escolha em vigor é a do backend, não a do arquivo: em modo web o
      // posicional da linha de comando vence as preferências, e sem esta
      // reconciliação a aba Consulta mostraria a lista guardada como se fosse
      // a monitorada — e o primeiro Salvar a imporia sem ninguém ter pedido.
      this.targetsState.set(data.meta.targets);
      this.dropUnknownSort(data.sorts);
      this.warningState.set(snapshotWarning(data));
      const delivered = !data.events.length || (this.onEvents?.(data.events) ?? true);
      if (delivered) this.since = data.sequence;
      // Esta consulta já foi com o valor morto: refaz sem ele em vez de
      // deixar a tabela vazia até alguém limpar os filtros à mão. A nova
      // consulta agenda a seguinte.
      if (this.dropUnknownFilters(data)) {
        void this.poll();
        return true;
      }
      this.schedule(data.poll);
      return true;
    } catch {
      if (ticket !== this.pollTicket) return true;
      this.warningState.set({ key: 'monitor.no-response', text: null });
      this.schedule(RETRY_SECONDS);
      return false;
    } finally {
      // Só a consulta mais recente desliga o aviso: a superada não pode
      // apagar a marcação de uma coleta que ainda está no ar.
      if (ticket === this.pollTicket) this.clearCollecting();
    }
  }

  /**
   * Marca a coleta em andamento, mas só depois do limiar: o ciclo rápido
   * termina antes e a faixa nem chega a mudar.
   */
  private markCollecting(): void {
    if (this.collectingTimer !== null) return;
    this.collectingTimer = setTimeout((): void => {
      this.collectingTimer = null;
      this.collectingState.set(true);
    }, COLLECTING_HINT_MS);
  }

  private clearCollecting(): void {
    if (this.collectingTimer !== null) {
      clearTimeout(this.collectingTimer);
      this.collectingTimer = null;
    }
    this.collectingState.set(false);
  }

  /**
   * A ordenação guardada só vale se o backend ainda a oferece (mesmo princípio
   * do `ColumnOrderService`): chave de uma versão anterior cai na primeira da
   * lista. O backend já respondeu com o padrão, então não precisa reconsultar.
   */
  private dropUnknownSort(sorts: readonly SortOptionModel[]): void {
    if (!sorts.length || sorts.some((item) => item.value === this.sortState())) return;
    this.sortState.set(sorts[0].value);
    // O sentido pedido era do que não existe mais: a ordenação nova começa no
    // natural dela.
    this.directionState.set(null);
    this.persistFilters();
  }

  /**
   * Autor e pipeline guardados só valem se `/data` ainda os descreve: o valor
   * de uma versão anterior (`sem-pipeline`, hoje `no-pipeline`) ou de um autor
   * que saiu da lista filtraria tudo, com uma opção que o select nem mostra.
   * Sem linhas coletadas não há do que comparar, e então nada é descartado.
   * Devolve se descartou algo, para quem chama refazer a consulta.
   */
  private dropUnknownFilters(data: PanelSnapshotModel): boolean {
    if (!data.collected || data.meta.total === 0) return false;
    const known = (options: readonly LabeledValueModel[]): ((value: string) => boolean) => {
      const values = new Set(options.map((option) => option.value));
      return (value: string): boolean => values.has(value);
    };
    const author = this.authorState().filter(known(data.filters.authors));
    const pipeline = this.pipelineState().filter(known(data.filters.pipelines));
    const dropped =
      author.length !== this.authorState().length ||
      pipeline.length !== this.pipelineState().length;
    if (!dropped) return false;
    this.authorState.set(author);
    this.pipelineState.set(pipeline);
    this.persistFilters();
    return true;
  }

  private persistFilters(): void {
    const value: StoredFilters = {
      sort: this.sortState(),
      direction: this.directionState(),
      author: this.authorState(),
      pipeline: this.pipelineState(),
      review: this.reviewState(),
    };
    this.store.write('filters', value);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(seconds: number): void {
    this.clearTimer();
    this.timer = setTimeout((): void => void this.poll(), Math.max(1, seconds) * 1000);
  }
}
