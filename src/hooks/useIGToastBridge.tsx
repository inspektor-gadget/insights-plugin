import { type Toast, toastStore, type ToastType } from '@inspektor-gadget/ig-desktop/frontend';
import { Button } from '@mui/material';
import { useSnackbar, type VariantType } from 'notistack';
import React, { useEffect } from 'react';

/**
 * Maps IG Desktop toast types onto notistack snackbar variants.
 *
 * Both vocabularies happen to use the same four keywords today; the
 * map keeps the bridge resilient to future divergence.
 */
const VARIANT_BY_TYPE: Record<ToastType, VariantType> = {
  success: 'success',
  error: 'error',
  info: 'info',
  warning: 'warning',
};

/**
 * Bridges IG Desktop's `toastStore` into Headlamp's notistack snackbar.
 *
 * IG Desktop's in-app `ToastContainer` is only mounted by the full Wails
 * app layout, so when the library is embedded in a Headlamp plugin via
 * `SvelteWrapper`, every toast emitted by IG Desktop code (failed
 * gadgets, removed instances, deleted sessions, …) is otherwise silently
 * dropped. This hook forwards every toast to `enqueueSnackbar` with a
 * matching variant, duration, and optional action button.
 *
 * Call this hook from every component that hosts IG Desktop Svelte
 * content (i.e. the same mount points as `useIGLanguageSync`). The
 * underlying `toastStore` is a singleton, so multiple co-mounted
 * subscribers would each fire — `IGPluginProvider` and
 * `ProjectGadgetTab` are never mounted together today, which keeps the
 * bridge duplicate-free.
 */
export function useIGToastBridge(): void {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  useEffect(() => {
    const handleToast = (toast: Toast) => {
      const mappedVariant = VARIANT_BY_TYPE[toast.type];
      if (!mappedVariant) {
        console.warn(
          `[useIGToastBridge] Unmapped IG toast type "${toast.type}", falling back to 'default'.`
        );
      }
      const variant: VariantType = mappedVariant ?? 'default';
      const hasDuration = typeof toast.duration === 'number' && toast.duration > 0;
      enqueueSnackbar(toast.message, {
        variant,
        autoHideDuration: hasDuration ? toast.duration : null,
        persist: !hasDuration,
        action: toast.action
          ? key => (
              <Button
                size="small"
                color="inherit"
                onClick={() => {
                  toast.action!.onClick();
                  closeSnackbar(key);
                }}
              >
                {toast.action.label}
              </Button>
            )
          : undefined,
      });
    };

    return toastStore.subscribe(handleToast);
  }, [enqueueSnackbar, closeSnackbar]);
}
