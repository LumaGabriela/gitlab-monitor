import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';
import { DensityService } from '../../../core/services/density.service';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { TextSizeService } from '../../../core/services/text-size.service';
import { chooseValue, selectAt } from '../../../../testing/select';
import { DisplaySectionComponent } from './display-section.component';

describe('DisplaySectionComponent', () => {
  let fixture: ComponentFixture<DisplaySectionComponent>;
  const host = (): HTMLElement => fixture.nativeElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DisplaySectionComponent],
      providers: [
        provideTestTranslate(),
        provideHttpClient(),
        provideHttpClientTesting(),
        providePreferences(new FakePreferencesStore()),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DisplaySectionComponent);
    fixture.detectChanges();
  });

  it('a densidade vem primeiro, em confortável, com as duas opções', () => {
    const select = selectAt(fixture, 0);
    expect(select.options().map((o) => o.value)).toEqual(['comfortable', 'compact']);
    expect(select.value()).toBe('comfortable');
  });

  it('trocar a densidade grava a preferência', async () => {
    await chooseValue(fixture, selectAt(fixture, 0), 'compact');

    expect(TestBed.inject(DensityService).density()).toBe('compact');
  });

  it('o tamanho do texto oferece os três degraus da escala', () => {
    const select = selectAt(fixture, 1);
    expect(select.options().map((o) => o.value)).toEqual(['sm', 'md', 'lg']);
    expect(select.value()).toBe('md');
  });

  it('trocar o tamanho do texto grava a preferência', async () => {
    await chooseValue(fixture, selectAt(fixture, 1), 'lg');

    expect(TestBed.inject(TextSizeService).size()).toBe('lg');
  });

  it('o limite de likes começa em zero, que não destaca nada', () => {
    const campo = host().querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    expect(campo?.value).toBe('0');
    expect(host().textContent).toContain('Zero não destaca nenhum selo');
  });

  it('o limite de likes não aceita texto: o que não é dígito é recusado', () => {
    const monitor = TestBed.inject(GitlabMonitorService);
    const set = vi.spyOn(monitor, 'setLikesHighlight');

    const campo = host().querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    campo.value = 'abc';
    campo.setSelectionRange(3, 3);
    campo.dispatchEvent(new Event('input'));

    expect(campo.value).toBe('');
    expect(set).toHaveBeenCalledWith(0);
  });
});
