import { Pipe, PipeTransform } from '@angular/core';

/**
 * Primeira letra maiúscula, o resto como veio.
 *
 * Não é `text-transform: capitalize`, que põe maiúscula em toda palavra
 * ("Sem Pipeline"), nem `::first-letter`, que não vale para um valor que
 * pode começar com número. O resto do texto fica intacto de propósito:
 * "1/2 resolvidas" e "sem conflito" vêm prontos do backend.
 */
@Pipe({ name: 'appCapitalize' })
export class CapitalizePipe implements PipeTransform {
  public transform(value: string | null | undefined): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
