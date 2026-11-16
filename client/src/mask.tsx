import {
createContext,
useContext,
useEffect,
useState,
type ReactNode,
} from "react";

/**
 * スクショモード (screenshot mode): a display-only mask for sharing
 * screenshots without revealing sales figures. While on, every money
 * amount and copy count in the app renders as *** (see yenMasked /
 * qtyMasked in format.ts) and chart bodies are blurred (the
 * .chart-blur class in theme.css). The underlying data is never
 * changed. The toggle lives in the 設定 view (DataTools.tsx);
 * the state is app-wide via this context and persists in
 * localStorage so it survives reloads.
 */

const STORAGE_KEY = "screenshot-mode";

interface MaskState {
  masked: boolean;
  setMasked: (v: boolean) => void;
}

const MaskContext = createContext<MaskState>({
  masked: false,
  setMasked: () => {},
});

export function MaskProvider({ children }: { children: ReactNode }) {
  const [masked, setMaskedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, masked ? "1" : "0");
    } catch {
      // Storage unavailable (private mode etc.) — the mode still
      // applies for this session.
    }
  }, [masked]);

  return (
    <MaskContext.Provider value={{ masked, setMasked: setMaskedState }}>
      {children}
    </MaskContext.Provider>
  );
}

export function useMask(): MaskState {
  return useContext(MaskContext);
}

/** Convenience hook for components that only read the flag. */
export function useMasked(): boolean {
  return useContext(MaskContext).masked;
}
