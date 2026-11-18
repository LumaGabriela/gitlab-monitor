import { DebugElement } from '@angular/core';
import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SelectComponent } from '../app/shared/ui/select/select.component';

/**
 * O `app-select` dentro de `root` (o primeiro, ou o de índice `index`). A lista é uma sobreposição do
 * CDK, fora do componente; o valor e as opções se leem na instância, e a escolha passa pela lista.
 */
export function selectAt(
  fixture: ComponentFixture<unknown>,
  index = 0,
  root: DebugElement = fixture.debugElement,
): SelectComponent {
  return root.queryAll(By.directive(SelectComponent))[index].componentInstance as SelectComponent;
}

/** O `app-select` marcado com `data-test`. */
export function selectIn(fixture: ComponentFixture<unknown>, dataTest: string): SelectComponent {
  return fixture.debugElement.query(By.css(`app-select[data-test="${dataTest}"]`))
    .componentInstance as SelectComponent;
}

/** Abre a lista do select e clica na opção de valor `value`, como a pessoa faria. */
export async function chooseValue(
  fixture: ComponentFixture<unknown>,
  select: SelectComponent,
  value: string,
): Promise<void> {
  const host = fixture.debugElement
    .queryAll(By.directive(SelectComponent))
    .find((el) => el.componentInstance === select)!;
  (host.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[role="combobox"]')!.click();
  fixture.detectChanges();
  await fixture.whenStable();
  const offset = select.placeholder() !== null ? 1 : 0;
  const position = select.options().findIndex((o) => o.value === value) + offset;
  document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')[position].click();
  fixture.detectChanges();
}
