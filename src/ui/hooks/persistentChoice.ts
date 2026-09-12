import { useCallback, useState } from "react";

/** The two Storage methods a persisted choice needs — injectable for tests. */
export interface ChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): ChoiceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A stored value only counts while it is still one of the allowed options. */
export function loadChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  storage: ChoiceStorage | null = browserStorage(),
): T {
  try {
    const stored = storage?.getItem(key);
    return allowed.find((option) => option === stored) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveChoice(key: string, value: string, storage: ChoiceStorage | null = browserStorage()): void {
  try {
    storage?.setItem(key, value);
  } catch {
    /* blocked storage (private mode): the choice just doesn't persist */
  }
}

/** A string choice saved per browser and validated on every load. */
export function usePersistentChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => loadChoice(key, allowed, fallback));
  const update = useCallback(
    (next: T) => {
      saveChoice(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, update];
}
