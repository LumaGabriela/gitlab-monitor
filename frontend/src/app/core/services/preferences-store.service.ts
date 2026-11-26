import { Injectable, Signal, WritableSignal, signal } from '@angular/core';
import {
  PreferenceKey,
  Preferences,
  PreferencesDocument,
  PreferencesResponse,
} from '../models/api/preferences-api.model';
import { BaseService } from './base.service';

export type SaveStatus = 'idle' | 'saving' | 'error';

/**
 * Dono das preferências do painel, guardadas pelo backend em
 * user-data/preferences.json. Os serviços leem e escrevem por aqui; nada vai
 * ao armazenamento do navegador.
 *
 * `write` é síncrono para quem chama: atualiza a memória na hora e agenda um
 * único POST por instante. Se já houver um em voo, o documento atual é
 * reenviado quando ele terminar, então nenhuma escrita se perde. Falha de
 * gravação aparece só em `saveStatus`; o valor segue valendo em memória.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesStore extends BaseService {
  private readonly document: WritableSignal<Preferences> = signal<Preferences>({});
  private readonly fileName: WritableSignal<string | null> = signal<string | null>(null);
  private readonly status: WritableSignal<SaveStatus> = signal<SaveStatus>('idle');

  private scheduled = false;
  private dirty = false;
  // Todo POST passa por esta fila, um de cada vez e na ordem em que foram
  // pedidos: o servidor nunca recebe um documento velho depois de um novo.
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  // Quando o carregamento falhou, o documento em memória não é o do arquivo:
  // gravá-lo apagaria o que a pessoa tinha salvo.
  private loadFailed = false;
  // Escritas feitas enquanto um `replace` espera a vez; valem por cima dele.
  private replacing = 0;
  private overlay: Preferences = {};

  public readonly file: Signal<string | null> = this.fileName.asReadonly();
  public readonly saveStatus: Signal<SaveStatus> = this.status.asReadonly();

  /** Nunca rejeita: sem resposta, o painel abre com o documento vazio. */
  public async load(): Promise<void> {
    try {
      const response = await this.get<PreferencesResponse>('panelPreferences');
      this.document.set({ ...(response?.preferences ?? {}) });
      this.fileName.set(response?.file ?? null);
      this.loadFailed = false;
    } catch {
      this.document.set({});
      this.fileName.set(null);
      this.loadFailed = true;
      this.status.set('error');
    }
  }

  public read(key: PreferenceKey): unknown {
    return this.document()[key];
  }

  public write(key: PreferenceKey, value: unknown): void {
    this.document.update((current) => ({ ...current, [key]: value }));
    // Com um `replace` na fila a escrita vai por cima dele, não antes.
    if (this.replacing > 0) {
      this.overlay = { ...this.overlay, [key]: value };
      return;
    }
    if (this.loadFailed) return;
    this.dirty = true;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask((): void => {
      this.scheduled = false;
      void this.enqueue((): Promise<void> => this.flush());
    });
  }

  public snapshot(): PreferencesDocument {
    return { version: 1, preferences: { ...this.document() } };
  }

  /**
   * Troca o documento inteiro, na vez dela na fila. Rejeita, sem mexer na
   * memória, se o POST falhar; escritas feitas enquanto espera valem por
   * cima do documento novo.
   */
  public async replace(document: PreferencesDocument): Promise<void> {
    this.replacing++;
    try {
      await this.enqueue(async (): Promise<void> => {
        await this.post<unknown>('panelPreferences', document);
        this.document.set({ ...document.preferences, ...this.overlay });
        this.loadFailed = false;
        this.status.set('idle');
      });
    } finally {
      this.replacing--;
      // Único lugar que despacha as escritas feitas durante o replace, tenha
      // ele dado certo ou não: o documento em memória (novo ou antigo, mais
      // essas escritas) é o que precisa chegar ao arquivo.
      if (this.replacing === 0) {
        const hadWrites = Object.keys(this.overlay).length > 0;
        this.overlay = {};
        if (hadWrites && !this.loadFailed) {
          this.dirty = true;
          this.scheduleFlush();
        }
      }
    }
  }

  private scheduleFlush(): void {
    void this.enqueue((): Promise<void> => this.flush());
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    // Fila vazia: começa já, sem esperar outro ciclo de microtarefas.
    const run = this.queued === 0 ? task() : this.tail.then(task);
    this.queued++;
    const settled = run
      .catch((): void => undefined)
      .then((): void => {
        this.queued--;
      });
    this.tail = settled;
    return run;
  }

  private async flush(): Promise<void> {
    if (!this.dirty) return;
    this.status.set('saving');
    let failed = false;
    while (this.dirty) {
      this.dirty = false;
      try {
        await this.post<unknown>('panelPreferences', this.snapshot());
        failed = false;
      } catch {
        failed = true;
      }
    }
    this.status.set(failed ? 'error' : 'idle');
  }
}
