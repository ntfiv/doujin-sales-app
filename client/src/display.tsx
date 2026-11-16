import {
createContext,
useContext,
useEffect,
useState,
type ReactNode,
} from "react";

/**
 * 表示設定 (display settings): app-wide, display-only preferences
 * toggled in the 設定 view. Both default to off (= the traditional
 * display) and persist in localStorage, like the screenshot mode
 * (mask.tsx). Neither changes any stored data or any judgement —
 * they only hide things on screen:
 *
 *   hideFirstBadge   — 「同県で初頒布」バッジを表示しない: the
 *                      FirstAppearanceBadge chip (and the matching
 *                      chart tooltip line) is not rendered anywhere.
 *   hideDiscontinued — 「廃盤」の頒布物を表示しない: in the イベント
 *                      一覧 day detail, rows for 廃盤 (discontinued)
 *                      products are not rendered. The day's totals
 *                      still include them — display only.
 *
 * The same provider also carries the 使用するCSV取り込み choice
 * (showSquareImport / showSokubaiImport / showManualImport): which
 * of the three sales-CSV import sections the CSV取込 view renders.
 * All three default to SHOWN (an unset key means shown) and turning
 * one off only hides that section — stored data and past imports
 * are unaffected. The 標準イベント一覧の差し替え section is not
 * part of the choice and always renders.
 */

const FIRST_BADGE_KEY = "hide-first-badge";
const DISCONTINUED_KEY = "hide-discontinued";
const CSV_SQUARE_KEY = "csv-import-square";
const CSV_SOKUBAI_KEY = "csv-import-sokubai";
const CSV_MANUAL_KEY = "csv-import-manual";

interface DisplaySettings {
  hideFirstBadge: boolean;
  setHideFirstBadge: (v: boolean) => void;
  hideDiscontinued: boolean;
  setHideDiscontinued: (v: boolean) => void;
  showSquareImport: boolean;
  setShowSquareImport: (v: boolean) => void;
  showSokubaiImport: boolean;
  setShowSokubaiImport: (v: boolean) => void;
  showManualImport: boolean;
  setShowManualImport: (v: boolean) => void;
}

const DisplaySettingsContext = createContext<DisplaySettings>({
  hideFirstBadge: false,
  setHideFirstBadge: () => {},
  hideDiscontinued: false,
  setHideDiscontinued: () => {},
  showSquareImport: true,
  setShowSquareImport: () => {},
  showSokubaiImport: true,
  setShowSokubaiImport: () => {},
  showManualImport: true,
  setShowManualImport: () => {},
});

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Default-on flag (used for the CSV import sections): shown unless explicitly stored as off. */
function readShown(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

function writeFlag(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    // Storage unavailable (private mode etc.) — the setting still
    // applies for this session.
  }
}

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [hideFirstBadge, setHideFirstBadgeState] = useState<boolean>(() =>
    readFlag(FIRST_BADGE_KEY),
  );
  const [hideDiscontinued, setHideDiscontinuedState] = useState<boolean>(() =>
    readFlag(DISCONTINUED_KEY),
  );
  const [showSquareImport, setShowSquareImportState] = useState<boolean>(() =>
    readShown(CSV_SQUARE_KEY),
  );
  const [showSokubaiImport, setShowSokubaiImportState] = useState<boolean>(() =>
    readShown(CSV_SOKUBAI_KEY),
  );
  const [showManualImport, setShowManualImportState] = useState<boolean>(() =>
    readShown(CSV_MANUAL_KEY),
  );

  useEffect(() => writeFlag(FIRST_BADGE_KEY, hideFirstBadge), [hideFirstBadge]);
  useEffect(() => writeFlag(DISCONTINUED_KEY, hideDiscontinued), [hideDiscontinued]);
  useEffect(() => writeFlag(CSV_SQUARE_KEY, showSquareImport), [showSquareImport]);
  useEffect(() => writeFlag(CSV_SOKUBAI_KEY, showSokubaiImport), [showSokubaiImport]);
  useEffect(() => writeFlag(CSV_MANUAL_KEY, showManualImport), [showManualImport]);

  return (
    <DisplaySettingsContext.Provider
      value={{
        hideFirstBadge,
        setHideFirstBadge: setHideFirstBadgeState,
        hideDiscontinued,
        setHideDiscontinued: setHideDiscontinuedState,
        showSquareImport,
        setShowSquareImport: setShowSquareImportState,
        showSokubaiImport,
        setShowSokubaiImport: setShowSokubaiImportState,
        showManualImport,
        setShowManualImport: setShowManualImportState,
      }}
    >
      {children}
    </DisplaySettingsContext.Provider>
  );
}

export function useDisplaySettings(): DisplaySettings {
  return useContext(DisplaySettingsContext);
}
