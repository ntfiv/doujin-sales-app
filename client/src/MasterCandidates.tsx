import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

export type MasterCandidate = ApiResponse<typeof api, "getMasterEvents">["events"][number];

/**
 * The standard event master list (標準イベント一覧), grouped by date.
 * Reference-only candidates: they are never registrations, and
 * picking one only fills the form (or, in the unregistered check,
 * registers exactly what the user tapped). Several candidates can
 * share a date — all are listed and nothing is auto-selected.
 * The query is shared by every consumer under one key, so the list
 * is fetched once per session (and refetched after a wholesale
 * replacement from the CSV取込 screen).
 */
export function useMasterCandidates() {
  const query = useQuery({
    queryKey: ["masterEvents"],
    queryFn: () => api.getMasterEvents({}),
  });
  const byDate = useMemo(() => {
    const map = new Map<string, MasterCandidate[]>();
    for (const e of query.data?.events ?? []) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [query.data]);
  return {
    isPending: query.isPending,
    total: query.data?.events.length ?? 0,
    candidatesFor: (date: string): MasterCandidate[] => byDate.get(date) ?? [],
  };
}

function candidatePlace(c: MasterCandidate): string {
  return [c.venue, [c.prefecture, c.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join("・");
}

/**
 * Candidate list for one date, used inside the event form: tapping
 * 「この候補で入力」 copies the candidate's event name / venue /
 * prefecture / city into the form fields. The candidate's note (the
 * 出典 citation) is shown as provenance only and is never copied
 * into the form's メモ. Saving stays the user's own action.
 * Renders nothing when the date has no candidates.
 */
export function MasterCandidatePicker({
  date,
  onPick,
}: {
  date: string;
  onPick: (candidate: MasterCandidate) => void;
}) {
  const { candidatesFor } = useMasterCandidates();
  const [picked, setPicked] = useState<number | null>(null);
  const candidates = candidatesFor(date);
  if (candidates.length === 0) return null;
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2">
      <p className="text-xs font-bold">
        標準イベント一覧の候補（{candidates.length}件）
        <span className="ml-1 font-normal text-[var(--dim)]">
          選ぶとフォームに転記されます（保存はされません）
        </span>
      </p>
      <ul className="mt-1.5 grid grid-cols-[minmax(0,1fr)] gap-1.5">
        {candidates.map((c, i) => (
          <li
            key={`${c.date}-${i}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius)] bg-[var(--surface)] px-2.5 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{c.eventName}</span>
              <span className="block text-xs text-[var(--dim)]">
                {candidatePlace(c)}
                {c.note ? <span className="ml-2">{c.note}</span> : null}
              </span>
            </span>
            <button
              type="button"
              aria-label={`候補「${c.eventName}」をフォームに入力`}
              onClick={() => {
                setPicked(i);
                onPick(c);
              }}
              className={`shrink-0 rounded-[var(--radius)] border px-3 py-1.5 text-xs font-medium ${
                picked === i
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] font-bold text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              {picked === i ? "転記済み" : "この候補で入力"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
