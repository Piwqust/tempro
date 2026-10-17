import { Coffee, Phone, Users, X } from "lucide-react";
import { useRef, useState } from "react";
import { useBackend, useManual } from "../data/backend";
import type { ManualKind, Question } from "../engine/types";
import { clock, dur } from "../lib/time";
import { Popover } from "./Popover";
import { ProjectPicker } from "./ProjectPicker";

const SKIP_KEY = "tempro.skippedQuestions";

function skipped(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SKIP_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** "Where were you?" after a long absence. An answer becomes a manual span: meetings and calls count. */
export function Questions({ questions }: { questions: Question[] }) {
  const has = useBackend().data;
  const [skip, setSkip] = useState(skipped);
  const open = questions.filter((q) => !skip.has(q.start)).slice(-3).reverse();
  if (!has || open.length === 0) return null;

  const dismiss = (q: Question) => {
    const next = new Set(skip).add(q.start);
    setSkip(next);
    try {
      localStorage.setItem(SKIP_KEY, JSON.stringify([...next].slice(-200)));
    } catch {
      // per-viewer convenience only
    }
  };

  return (
    <section className="questions">
      {open.map((q) => (
        <QuestionRow key={q.start} q={q} onSkip={() => dismiss(q)} />
      ))}
    </section>
  );
}

function QuestionRow({ q, onSkip }: { q: Question; onSkip: () => void }) {
  const manual = useManual();
  const [pick, setPick] = useState<{ kind: ManualKind; anchor: HTMLElement } | null>(null);
  const meeting = useRef<HTMLButtonElement>(null);
  const callBtn = useRef<HTMLButtonElement>(null);

  const answer = (kind: ManualKind, projectId: string | null) => manual.add({ start: q.start, end: q.end, kind, projectId });

  return (
    <div className="question card">
      <div className="question-text">
        <span className="question-title">Тебя не было {dur(q.end - q.start)}</span>
        <span className="muted">
          {clock(q.start)} – {clock(q.end)} · что это было?
        </span>
      </div>
      <div className="question-actions">
        <button ref={meeting} type="button" className="btn btn-ghost-white" onClick={() => setPick({ kind: "meeting", anchor: meeting.current! })}>
          <Users size={15} /> Встреча
        </button>
        <button ref={callBtn} type="button" className="btn btn-ghost-white" onClick={() => setPick({ kind: "call", anchor: callBtn.current! })}>
          <Phone size={15} /> Звонок
        </button>
        <button type="button" className="btn btn-ghost-white" onClick={() => answer("break", null)}>
          <Coffee size={15} /> Перерыв
        </button>
        <button type="button" className="icon-btn" title="Не спрашивать" onClick={onSkip}>
          <X size={16} />
        </button>
      </div>
      <Popover anchor={pick?.anchor ?? null} open={!!pick} onClose={() => setPick(null)} align="end">
        <ProjectPicker
          current={null}
          onPick={(id) => {
            if (pick) answer(pick.kind, id);
            setPick(null);
          }}
          footer={
            <button type="button" className="link" onClick={() => (pick && answer(pick.kind, null), setPick(null))}>
              Без проекта
            </button>
          }
        />
      </Popover>
    </div>
  );
}
