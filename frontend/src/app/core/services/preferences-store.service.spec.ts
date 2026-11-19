import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PreferencesDocument } from '../models/api/preferences-api.model';
import { PreferencesStore } from './preferences-store.service';

const FILE = 'user-data/preferences.json';

describe('PreferencesStore', () => {
  let store: PreferencesStore;
  let http: HttpTestingController;

  /** Deixa as promessas pendentes (firstValueFrom, await) terminarem. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve));
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(PreferencesStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('carrega o documento e lê cada chave', async () => {
    const loading = store.load();
    http
      .expectOne('/preferences')
      .flush({ version: 1, preferences: { theme: 'dark' }, file: FILE });
    await loading;

    expect(store.read('theme')).toBe('dark');
    expect(store.read('density')).toBeUndefined();
    expect(store.file()).toBe(FILE);
  });

  it('abre com o documento vazio quando o backend não responde', async () => {
    const loading = store.load();
    http.expectOne('/preferences').flush(null, { status: 502, statusText: 'Bad Gateway' });
    await loading;

    expect(store.read('theme')).toBeUndefined();
    expect(store.file()).toBeNull();
  });

  it('junta várias escritas do mesmo instante num POST só, com o documento inteiro', async () => {
    store.write('theme', 'dark');
    store.write('density', 'compact');
    await Promise.resolve();

    const request = http.expectOne({ method: 'POST', url: '/preferences' });
    expect(request.request.body).toEqual({
      version: 1,
      preferences: { theme: 'dark', density: 'compact' },
    });
    request.flush({});
    await settle();
    expect(store.saveStatus()).toBe('idle');
  });

  it('não perde a escrita feita enquanto outro POST está em voo', async () => {
    store.write('theme', 'dark');
    await Promise.resolve();
    const first = http.expectOne({ method: 'POST', url: '/preferences' });
    expect(store.saveStatus()).toBe('saving');

    store.write('theme', 'light');
    first.flush({});
    await settle();

    const second = http.expectOne({ method: 'POST', url: '/preferences' });
    expect((second.request.body as PreferencesDocument).preferences.theme).toBe('light');
    second.flush({});
    await settle();
    expect(store.saveStatus()).toBe('idle');
  });

  it('marca erro quando a gravação falha e mantém o valor em memória', async () => {
    store.write('theme', 'dark');
    await Promise.resolve();
    http
      .expectOne({ method: 'POST', url: '/preferences' })
      .flush({ error: 'x' }, { status: 500, statusText: 'x' });
    await settle();

    expect(store.saveStatus()).toBe('error');
    expect(store.read('theme')).toBe('dark');
  });

  it('a próxima gravação bem-sucedida tira o erro', async () => {
    store.write('theme', 'dark');
    await Promise.resolve();
    http
      .expectOne({ method: 'POST', url: '/preferences' })
      .flush({ error: 'x' }, { status: 500, statusText: 'x' });
    await settle();
    expect(store.saveStatus()).toBe('error');

    store.write('theme', 'light');
    await Promise.resolve();
    http.expectOne({ method: 'POST', url: '/preferences' }).flush({});
    await settle();
    expect(store.saveStatus()).toBe('idle');
  });

  it('snapshot devolve uma cópia do documento atual', async () => {
    store.write('density', 'compact');
    const snap = store.snapshot();

    expect(snap).toEqual({ version: 1, preferences: { density: 'compact' } });
    store.write('density', 'comfortable');
    expect(snap.preferences.density).toBe('compact');

    await Promise.resolve();
    http.expectOne({ method: 'POST', url: '/preferences' }).flush({});
    await settle();
  });

  it('replace troca o documento depois que o backend aceita', async () => {
    const done = store.replace({ version: 1, preferences: { theme: 'light' } });
    http.expectOne({ method: 'POST', url: '/preferences' }).flush({});
    await done;

    expect(store.read('theme')).toBe('light');
  });

  it('replace rejeita quando o backend recusa, sem mexer no documento em memória', async () => {
    const loading = store.load();
    http
      .expectOne('/preferences')
      .flush({ version: 1, preferences: { theme: 'dark' }, file: FILE });
    await loading;

    const done = store.replace({ version: 1, preferences: { theme: 'light' } });
    const rejected = expect(done).rejects.toBeDefined();
    http
      .expectOne({ method: 'POST', url: '/preferences' })
      .flush({ error: 'inválido' }, { status: 400, statusText: 'Bad Request' });
    await rejected;

    expect(store.read('theme')).toBe('dark');
  });

  it('replace espera o POST em voo terminar e as escritas feitas durante ele valem por cima', async () => {
    store.write('theme', 'dark');
    await Promise.resolve();
    const first = http.expectOne({ method: 'POST', url: '/preferences' });

    const done = store.replace({ version: 1, preferences: { density: 'compact' } });
    store.write('textSize', 'large');
    await settle();
    // Nada novo no ar enquanto o primeiro não terminar.
    http.expectNone({ method: 'POST', url: '/preferences' });

    first.flush({});
    await settle();
    const second = http.expectOne({ method: 'POST', url: '/preferences' });
    expect((second.request.body as PreferencesDocument).preferences).toEqual({
      density: 'compact',
    });
    second.flush({});
    await done;
    await settle();

    const third = http.expectOne({ method: 'POST', url: '/preferences' });
    expect((third.request.body as PreferencesDocument).preferences).toEqual({
      density: 'compact',
      textSize: 'large',
    });
    third.flush({});
    await settle();
    expect(store.read('theme')).toBeUndefined();
    expect(store.read('textSize')).toBe('large');
    expect(store.saveStatus()).toBe('idle');
  });

  it('replace que falha não perde a escrita feita enquanto esperava', async () => {
    store.write('theme', 'dark');
    await Promise.resolve();
    const first = http.expectOne({ method: 'POST', url: '/preferences' });

    const done = store.replace({ version: 1, preferences: { density: 'compact' } });
    const rejected = expect(done).rejects.toBeDefined();
    store.write('textSize', 'large');
    first.flush({});
    await settle();
    http
      .expectOne({ method: 'POST', url: '/preferences' })
      .flush({ error: 'x' }, { status: 400, statusText: 'Bad Request' });
    await rejected;
    await settle();

    const retry = http.expectOne({ method: 'POST', url: '/preferences' });
    expect((retry.request.body as PreferencesDocument).preferences).toEqual({
      theme: 'dark',
      textSize: 'large',
    });
    retry.flush({});
    await settle();
    expect(store.saveStatus()).toBe('idle');
  });

  describe('quando o carregamento falhou', () => {
    beforeEach(async () => {
      const loading = store.load();
      http.expectOne('/preferences').flush(null, { status: 502, statusText: 'Bad Gateway' });
      await loading;
    });

    it('o aviso de gravação já aparece', () => {
      expect(store.saveStatus()).toBe('error');
    });

    it('write guarda em memória e não manda POST, para não apagar o arquivo', async () => {
      store.write('theme', 'dark');
      await settle();

      http.expectNone({ method: 'POST', url: '/preferences' });
      expect(store.read('theme')).toBe('dark');
      expect(store.saveStatus()).toBe('error');
    });

    it('replace (importação explícita) ainda grava', async () => {
      const done = store.replace({ version: 1, preferences: { theme: 'light' } });
      http.expectOne({ method: 'POST', url: '/preferences' }).flush({});
      await done;

      expect(store.read('theme')).toBe('light');
      expect(store.saveStatus()).toBe('idle');
    });
  });
});
