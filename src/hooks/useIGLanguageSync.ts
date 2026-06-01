import { setLanguage } from '@inspektor-gadget/ig-desktop/frontend';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect } from 'react';

/**
 * Mirrors Headlamp's active language into the embedded IG Desktop UI.
 *
 * Should be called from every component that renders IG Desktop / Svelte
 * content (e.g. `IGPluginProvider`, `ProjectGadgetTab`). Calling it from
 * multiple places is safe — `setLanguage()` is a global, idempotent call,
 * and the language sync listener detaches cleanly on unmount.
 *
 * The hook uses Headlamp's plugin i18next instance, which is itself kept
 * in sync with the host i18n by `@kinvolk/headlamp-plugin/lib`'s
 * `useTranslation` hook.
 */
export function useIGLanguageSync(): void {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!i18n) return;
    setLanguage(i18n.language);
    const handleLanguageChanged = (lng: string) => setLanguage(lng);
    i18n.on('languageChanged', handleLanguageChanged);
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, [i18n]);
}
