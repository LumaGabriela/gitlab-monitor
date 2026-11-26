import { TranslateService } from '@ngx-translate/core';
import { Preset, isBuiltInPreset } from '../../core/services/presets.service';
import { translatedOr } from './cell-text';

/**
 * O nome de um preset no idioma ativo: o pronto vem do catálogo
 * (`settings.preset-<id>`), o da pessoa é o que ela escreveu. Quem chama
 * precisa ler o sinal de idioma antes, como em `translatedOr`.
 */
export function presetLabel(translate: TranslateService, preset: Preset): string {
  return isBuiltInPreset(preset.id)
    ? translatedOr(translate, `settings.preset-${preset.id}`, preset.name)
    : preset.name;
}
