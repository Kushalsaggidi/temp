"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { IconAlert, IconCheck, IconX } from "./icons";

export type ToastTone = "success" | "warning" | "error" | "neutral";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastApi {
  push(toast: Omit<Toast, "id">): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DISMISS_AFTER_MS = 5_000;

const GLYPH = {
  success: IconCheck,
  warning: IconAlert,
  error: IconX,
  neutral: IconCheck,
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
  }, []);

  const api = useMemo<ToastApi>(() => ({ push }), [push]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => dismiss(toast.id), DISMISS_AFTER_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        {toasts.map((toast) => {
          const Glyph = GLYPH[toast.tone];
          return (
            <div
              className={`toast toast--${toast.tone}`}
              key={toast.id}
              role={toast.tone === "error" ? "alert" : "status"}
            >
              <Glyph className="toast__icon" />
              <div className="toast__body">
                <p className="toast__title">{toast.title}</p>
                {toast.detail ? <p className="toast__detail">{toast.detail}</p> : null}
              </div>
              <button
                className="toast__close"
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                <IconX style={{ width: 14, height: 14 }} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns a no-op publisher outside a provider so components stay usable in tests. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { push: () => undefined };
}
