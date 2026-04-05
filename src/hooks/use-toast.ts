// src/hooks/use-toast.ts
// Lightweight toast state manager — no external deps.
"use client";

import * as React from "react";
import type { ToastProps } from "@/components/ui/toast";

const TOAST_LIMIT = 5;
const TOAST_REMOVE_DELAY = 4000;

type ToastInput = Omit<ToastProps, "id"> & {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
};

type ToastState = ToastInput & {
  id: string;
  open: boolean;
};

type Action =
  | { type: "ADD_TOAST"; toast: ToastState }
  | { type: "UPDATE_TOAST"; toast: Partial<ToastState> & { id: string } }
  | { type: "DISMISS_TOAST"; toastId?: string }
  | { type: "REMOVE_TOAST"; toastId?: string };

interface State {
  toasts: ToastState[];
}

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function addToRemoveQueue(toastId: string, dispatch: React.Dispatch<Action>) {
  if (toastTimeouts.has(toastId)) return;
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({ type: "REMOVE_TOAST", toastId });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(toastId, timeout);
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };
    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };
    case "DISMISS_TOAST": {
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toastId || action.toastId === undefined
            ? { ...t, open: false }
            : t
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) return { ...state, toasts: [] };
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
}

// Global listeners so toast() can be called outside React
const listeners: Array<React.Dispatch<Action>> = [];
let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => listener(action));
}

export function toast(props: ToastInput) {
  const id = props.id ?? genId();
  const toastObj: ToastState = { ...props, id, open: true };

  dispatch({ type: "ADD_TOAST", toast: toastObj });

  // Auto-dismiss
  const timeout = setTimeout(() => {
    dispatch({ type: "DISMISS_TOAST", toastId: id });
    toastTimeouts.delete(id);
    setTimeout(() => dispatch({ type: "REMOVE_TOAST", toastId: id }), 300);
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(id, timeout);

  return {
    id,
    dismiss: () => dispatch({ type: "DISMISS_TOAST", toastId: id }),
    update: (props: Partial<ToastState>) =>
      dispatch({ type: "UPDATE_TOAST", toast: { ...props, id } }),
  };
}

export function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    const listener: React.Dispatch<Action> = () => {
      setState({ ...memoryState });
    };
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}
