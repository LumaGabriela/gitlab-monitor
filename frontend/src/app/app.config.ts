import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  Injector,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { APP_ROUTES } from './app.routes';
import { LanguageService, initialLanguage } from './core/services/language.service';
import { PreferencesStore } from './core/services/preferences-store.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    provideRouter(APP_ROUTES),
    // pt-BR é o padrão; a escolha de quem usa vem do <html> escrito pelo Python, e
    // o en é o reserva quando uma chave falta no catálogo em uso.
    provideTranslateService({
      loader: provideTranslateHttpLoader({ prefix: 'assets/i18n/', suffix: '.json' }),
      lang: initialLanguage(),
      fallbackLang: 'en',
    }),
    // As preferências chegam do backend antes do bootstrap: os serviços as
    // leem na construção, e o idioma guardado vale desde a primeira pintura.
    // `inject` só vale na parte síncrona, por isso as dependências saem antes
    // do `await`.
    provideAppInitializer(async (): Promise<void> => {
      const store = inject(PreferencesStore);
      const injector = inject(Injector);
      await store.load();
      injector.get(LanguageService).restore();
    }),
  ],
};
