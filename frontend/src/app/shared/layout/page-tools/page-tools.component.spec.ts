import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PageToolsComponent } from './page-tools.component';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';

describe('PageToolsComponent', () => {
  let fixture: ComponentFixture<PageToolsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageToolsComponent],
      providers: [
        provideTestTranslate(),
        provideRouter([]),
        providePreferences(new FakePreferencesStore()),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PageToolsComponent);
    fixture.detectChanges();
  });

  it('mostra idioma, tema e o link para as configurações, nesta ordem', () => {
    const tools = fixture.nativeElement.querySelector('.ui-page-tools');
    const kids = Array.from(tools.children).map((el) => (el as HTMLElement).tagName.toLowerCase());
    expect(kids).toEqual(['app-language-selector', 'app-theme-toggle', 'a']);
    expect(tools.querySelector('a').getAttribute('href')).toBe('/settings');
  });

  it('o link das configurações tem nome acessível', () => {
    const link = fixture.nativeElement.querySelector('.ui-page-tools a') as HTMLElement;
    expect(link.getAttribute('aria-label')).toBe('Abrir configurações');
  });
});
