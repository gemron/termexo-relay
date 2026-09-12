/**
 * The UI primitives every console page builds on.
 *
 * They are re-exported from one module so a page imports wording, time formatting and icons from
 * a single place, and so moving any of them costs one line instead of a sweep over the pages.
 */
export { I18nService, registerTranslations } from './i18n/i18n.service';
export type { TranslationBundle } from './i18n/i18n.service';
export { formatRelativeTime } from './i18n/relative-time';
export { TranslatePipe } from './i18n/translate.pipe';
export { IconComponent } from './icon/icon';
