import { Provider } from '@angular/core';
import { TranslateLoader, TranslationObject, provideTranslateService } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import en from '../assets/i18n/en.json';
import pt from '../assets/i18n/pt.json';

/**
 * Catálogos reais, carregados do próprio pt.json e en.json e sem HTTP. Com um catálogo
 * falso o teste passaria mesmo com a chave escrita errada no template; com o
 * de verdade, uma chave inexistente aparece crua e o teste quebra.
 */
class StaticLoader extends TranslateLoader {
  public override getTranslation(lang: string): Observable<TranslationObject> {
    return of((lang === 'en' ? en : pt) as TranslationObject);
  }
}

export function provideTestTranslate(): Provider[] {
  return [
    provideTranslateService({
      loader: { provide: TranslateLoader, useClass: StaticLoader },
      lang: 'pt',
    }),
  ];
}
