import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';

import { ThemeService } from '../../../core/services/theme.service';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';
import { IconComponent } from '../icon/icon.component';
import { ThemeToggleComponent } from './theme-toggle.component';

describe('ThemeToggleComponent', () => {
  let fixture: ComponentFixture<ThemeToggleComponent>;
  let component: ThemeToggleComponent;
  let themeService: ThemeService;

  const button = (): HTMLButtonElement =>
    fixture.debugElement.query(By.css('button')).nativeElement as HTMLButtonElement;

  const iconName = (): string =>
    (
      fixture.debugElement.query(By.directive(IconComponent)).componentInstance as IconComponent
    ).name();

  beforeEach(async () => {
    document.documentElement.classList.remove('dark');

    await TestBed.configureTestingModule({
      imports: [ThemeToggleComponent],
      // Adaptação: catálogo real e preferências sem rede, como nos demais specs daqui.
      providers: [provideTestTranslate(), providePreferences(new FakePreferencesStore())],
    }).compileComponents();

    themeService = TestBed.inject(ThemeService);
    fixture = TestBed.createComponent(ThemeToggleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('cria o componente', () => {
    expect(component).toBeTruthy();
  });

  it('o botão é um appIconButton (classe .ui-icon-button)', () => {
    expect(button().classList.contains('ui-icon-button')).toBe(true);
    expect(button().classList.contains('ui-icon-button--md')).toBe(true);
  });

  it('com square, usa o tamanho pequeno do botão', () => {
    fixture.componentRef.setInput('square', true);
    fixture.detectChanges();

    expect(button().classList.contains('ui-icon-button--sm')).toBe(true);
    expect(button().classList.contains('ui-icon-button--md')).toBe(false);
  });

  it('anuncia o rótulo do tema oposto ao atual', () => {
    expect(button().getAttribute('aria-label')).toBe('Mudar para o tema escuro');

    button().click();
    fixture.detectChanges();

    expect(button().getAttribute('aria-label')).toBe('Mudar para o tema claro');
  });

  it('mostra o ícone moon no claro e sun no escuro', () => {
    expect(iconName()).toBe('moon');

    button().click();
    fixture.detectChanges();

    expect(iconName()).toBe('sun');
  });

  it('alterna o tema ao clicar e o rótulo diz o que o próximo clique faz, sem aria-pressed', () => {
    expect(component.currentTheme()).toBe('light');
    expect(button().getAttribute('aria-label')).toBe('Mudar para o tema escuro');
    expect(button().hasAttribute('aria-pressed')).toBe(false);

    button().click();
    fixture.detectChanges();

    expect(themeService.currentTheme()).toBe('dark');
    expect(button().getAttribute('aria-label')).toBe('Mudar para o tema claro');
    expect(button().hasAttribute('aria-pressed')).toBe(false);

    button().click();
    fixture.detectChanges();

    expect(themeService.currentTheme()).toBe('light');
    expect(button().getAttribute('aria-label')).toBe('Mudar para o tema escuro');
  });
});
