const collators = new Map<string, Intl.Collator>();

/** Colador do idioma, um por idioma: ignora acento e caixa e ordena números pelo valor. */
export function collatorFor(lang: string): Intl.Collator {
  let collator = collators.get(lang);
  if (!collator) {
    collator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' });
    collators.set(lang, collator);
  }
  return collator;
}
