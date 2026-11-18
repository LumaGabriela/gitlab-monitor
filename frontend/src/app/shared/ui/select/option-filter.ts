import { SelectOption } from './select.model';

/**
 * Busca das listas de seleção: a mesma regra no `app-select` e no
 * `app-multi-select`, para a lista responder igual nos dois.
 *
 * Compara sem acento e sem caixa, porque quem digita "revisao" está
 * procurando "Revisão", e procura em qualquer parte do rótulo: os nomes aqui
 * são caminhos de projeto (`grupo/projeto`), e exigir o começo obrigaria a
 * digitar o grupo inteiro para achar o projeto.
 */
export function normalizeTerm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

/** As opções que casam com o termo; termo em branco não filtra nada. */
export function filterOptions(
  options: readonly SelectOption[],
  term: string,
): readonly SelectOption[] {
  const procurado: string = normalizeTerm(term.trim());
  if (!procurado) return options;
  return options.filter((option: SelectOption): boolean =>
    normalizeTerm(option.label).includes(procurado),
  );
}
