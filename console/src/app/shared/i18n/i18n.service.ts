import { computed, effect, Injectable, signal } from '@angular/core';

/**
 * The languages the console is translated into, in the order a browser locale is matched against.
 *
 * Chinese is the authored language and English the fallback. The list mirrors what the wording
 * tables actually cover: offering a language with no table behind it would only show keys.
 */
const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const;

export type ConsoleLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Used both when no browser locale matches and when a key is missing from the active table. */
const FALLBACK_LANGUAGE = 'en' satisfies ConsoleLanguage;
type FallbackLanguage = typeof FALLBACK_LANGUAGE;

type TranslationParams = Readonly<Record<string, string | number>>;
type TranslationTable = Readonly<Record<string, string>>;

/**
 * Wording a feature contributes.
 *
 * The fallback language is required because every lookup ends there; the rest are optional, so a
 * feature can ship the languages it has been translated into without stubbing out the others.
 */
export type TranslationBundle = Readonly<Record<FallbackLanguage, TranslationTable>> &
  Readonly<Partial<Record<Exclude<ConsoleLanguage, FallbackLanguage>, TranslationTable>>>;

/**
 * Tables registered by the features that own them.
 *
 * Wording lives beside the screens it belongs to rather than inside this service, so the service
 * knows nothing about the console's pages and a lazily loaded screen can ship its strings in its
 * own chunk.
 */
const BUNDLES: TranslationBundle[] = [];

/**
 * Bumped on every registration.
 *
 * A `computed()` that has already resolved a key has to re-run when a later chunk registers the
 * table that key belongs to, otherwise it would keep serving the raw key.
 */
const bundleCount = signal(0);

export function registerTranslations(bundle: TranslationBundle): void {
  if (BUNDLES.includes(bundle)) {
    return;
  }
  BUNDLES.push(bundle);
  bundleCount.set(BUNDLES.length);
}

function lookup(language: ConsoleLanguage, key: string): string | undefined {
  bundleCount();
  for (const bundle of BUNDLES) {
    const value = bundle[language]?.[key] ?? bundle[FALLBACK_LANGUAGE][key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** The first browser language the console has wording for, matching `zh` to `zh-CN` as well. */
function resolveSystemLanguage(languages: readonly string[]): ConsoleLanguage {
  for (const value of languages) {
    const normalized = value.trim().toLowerCase();
    const match = SUPPORTED_LANGUAGES.find(
      (language) =>
        normalized === language.toLowerCase() ||
        normalized.startsWith(`${language.toLowerCase()}-`) ||
        normalized.split('-')[0] === language.toLowerCase().split('-')[0],
    );
    if (match) {
      return match;
    }
  }
  return FALLBACK_LANGUAGE;
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return [FALLBACK_LANGUAGE];
  }
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/**
 * Resolves the console's wording and the locale its dates are formatted in.
 *
 * The console runs on the relay's own origin and offers no language picker, so the language is
 * the browser's and nothing else: there is no preference to store, and none to read.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly language = signal<ConsoleLanguage>(resolveSystemLanguage(browserLanguages()));

  /** A BCP 47 tag for `Intl`; the console's language codes are already valid tags. */
  readonly locale = computed(() => this.language());

  constructor() {
    effect(() => {
      if (typeof document !== 'undefined') {
        document.documentElement.lang = this.language();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('languagechange', () => {
        this.language.set(resolveSystemLanguage(browserLanguages()));
      });
    }
  }

  t(key: string, params: TranslationParams = {}): string {
    const value = lookup(this.language(), key) ?? key;
    return value.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
  }
}
