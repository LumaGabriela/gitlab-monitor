import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTestTranslate } from '../testing/translate';
import { AppComponent } from './app.component';
import { PreferencesStore, SaveStatus } from './core/services/preferences-store.service';

describe('AppComponent', () => {
  let status: WritableSignal<SaveStatus>;
  let fixture: ComponentFixture<AppComponent>;

  const alert = (): HTMLElement => fixture.nativeElement.querySelector('app-alert') as HTMLElement;

  beforeEach(async () => {
    status = signal<SaveStatus>('idle');
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        provideTestTranslate(),
        { provide: PreferencesStore, useValue: { saveStatus: status.asReadonly() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  });

  it('mantém o aviso no DOM, vazio e sem caixa, enquanto nada falhou', () => {
    expect(alert()).not.toBeNull();
    expect(alert().textContent?.trim()).toBe('');
    expect(alert().className).toContain('ui-preferences-alert--quiet');
  });

  it('diz a falha dentro do mesmo aviso quando a gravação falha', async () => {
    const before = alert();
    status.set('error');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(alert()).toBe(before);
    expect(alert().textContent).toContain('Não foi possível salvar as preferências');
    expect(alert().className).not.toContain('ui-preferences-alert--quiet');
  });

  it('desenha a casca com Painel e as sete entradas de Configurações', () => {
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('.ui-shell__sidebar .ui-nav-item'),
    ) as HTMLElement[];
    expect(links.map((a) => a.textContent!.trim())).toEqual([
      'Painel',
      'Consulta',
      'Notificações',
      'Exibição',
      'Colunas da tabela',
      'Destaques de linha',
      'Presets',
      'Dados',
    ]);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('main').length).toBe(1);
    expect(host.querySelector('main .ui-preferences-alert')).not.toBeNull();
  });
});
