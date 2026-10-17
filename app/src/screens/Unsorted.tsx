import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleDashed, FolderPlus, Inbox, Plus, Sparkles, X } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { assign, assignApp } from "../data/assign";
import { autoSort, type NewProjects } from "../data/ai";
import { call } from "../data/api";
import { useSettings } from "../data/backend";
import { actions, useStore } from "../data/store";
import { useModel, useProjects } from "../data/useModel";
import { appName } from "../engine/context";
import { PERSONAL } from "../engine/rules";
import type { Model } from "../engine/types";
import { t, tj } from "../lib/i18n";
import { addDays, dayNum, dur, MIN, startOfDay, weekday } from "../lib/time";
import { AppIcon } from "../ui/bits";
import { Popover } from "../ui/Popover";
import { ProjectPicker } from "../ui/ProjectPicker";
import { TopBar } from "../ui/TopBar";
import { Loading, LoadError } from "./states";
import { ProjectIcon } from "../ui/ProjectIcon";

type Row = { context: string; ms: number; last: number; days: Set<number> };
type Group = { app: string; ms: number; rows: Row[] };
type Suggestion = { id: string; projectId: string | null; confidence: number; reason: string };
const rowId = (app: string, ctx: string) => `${app}\u0000${ctx}`;

const RANGES = [
  { id: 1, label: t("Сегодня") },
  { id: 7, label: t("7 дней") },
  { id: 30, label: t("30 дней") },
] as const;

const TINTS = ["blue", "amber", "olive", "green"] as const;

function groupUnassigned(model: Model): Group[] {
  const apps = new Map<string, Map<string, Row>>();
  for (const s of model.segments) {
    if (s.projectId) continue;
    const ctx = s.context || appName(s.app);
    let rows = apps.get(s.app);
    if (!rows) apps.set(s.app, (rows = new Map()));
    let r = rows.get(ctx);
    if (!r) rows.set(ctx, (r = { context: ctx, ms: 0, last: 0, days: new Set() }));
    r.ms += s.end - s.start;
    r.last = Math.max(r.last, s.end);
    r.days.add(startOfDay(s.start));
  }
  return [...apps.entries()]
    .map(([app, rows]) => {
      const list = [...rows.values()].filter((r) => r.ms >= MIN).sort((a, b) => b.ms - a.ms);
      return { app, rows: list, ms: list.reduce((n, r) => n + r.ms, 0) };
    })
    .filter((g) => g.rows.length)
    .sort((a, b) => b.ms - a.ms);
}

export function Unsorted() {
  const [days, setDays] = useState<number>(7);
  const today = startOfDay(Date.now());
  const from = addDays(today, 1 - days);
  const { model, error, loading } = useModel(from, addDays(today, 1));
  const groups = useMemo(() => (model ? groupUnassigned(model) : []), [model]);
  const total = groups.reduce((n, g) => n + g.ms, 0);
  const share = model && model.active ? Math.round((1 - total / model.active) * 100) : 0;
  const { settings, available } = useSettings();
  const { projects, rules } = useStore();
  const hints = useMemo(() => new Map<string, Suggestion>(), []);
  const [aiState, setAiState] = useState<{ busy: boolean; error?: string; done?: number }>({ busy: false });
  const qc = useQueryClient();

  // the same pass as the background one, over the range on screen: confident answers become ✨ rules,
  // titles that look like a missing project are collected for the card above
  const suggest = async () => {
    if (!model) return;
    setAiState({ busy: true });
    try {
      const n = await autoSort(model, projects, rules);
      await qc.invalidateQueries({ queryKey: ["ui.ai_new"] });
      setAiState({ busy: false, done: n });
    } catch (e) {
      setAiState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <TopBar
        icon={<Inbox size={14} strokeWidth={1.9} />}
        section={t("Неразобранное")}
        right={
          <div className="segmented">
            {RANGES.map((r) => (
              <button key={r.id} type="button" data-on={days === r.id || undefined} onClick={() => setDays(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="filterbar">
        <span className="summary summary-left">
          {tj("{dur} без проекта", { dur: <b>{dur(total)}</b> })}
          <span className="summary-sep" />
          {t("разобрано {share}% времени", { share })}
        </span>
        <span className="filterbar-right hint">
          {aiState.error ? (
            <span className="summary-err">{aiState.error}</span>
          ) : aiState.done !== undefined ? (
            t("ИИ разнёс {n} строк — проверить можно на странице проекта ✨", { n: aiState.done })
          ) : (
            t("Проект для строки или всей программы (+) — правило сразу пересчитает историю")
          )}
        </span>
        {available && settings.aiProvider !== "none" && (
          <button type="button" className="btn btn-ghost-white" disabled={aiState.busy || !groups.length} onClick={suggest}>
            <Sparkles size={15} /> {aiState.busy ? t("Думаю…") : t("Предложить с ИИ")}
          </button>
        )}
      </div>
      <div className="screen screen-list">
        {error ? (
          <LoadError error={error} />
        ) : loading || !model ? (
          <Loading />
        ) : groups.length === 0 ? (
          <div className="empty">{t("Всё разобрано")}</div>
        ) : (
          <>
            <NewProjectsCard />
            {groups.map((g, i) => (
              <AppGroup key={g.app} group={g} tint={TINTS[i % TINTS.length]} hints={hints} />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function AppGroup({ group, tint, hints }: { group: Group; tint: (typeof TINTS)[number]; hints: Map<string, Suggestion> }) {
  const [limit, setLimit] = useState(8);
  const plus = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);

  return (
    <section className="group">
      <header className="group-head">
        <span className={`status-pill status-${tint}`}>
          <AppIcon app={group.app} size={18} />
          {appName(group.app)}
        </span>
        <span className="count-pill">{group.rows.length}</span>
        <span className="group-total">{dur(group.ms)}</span>
        <button ref={plus} type="button" className="icon-btn" title={t("Вся программа {app} → проект", { app: appName(group.app) })} onClick={() => setPicking(true)}>
          <Plus size={17} strokeWidth={1.7} />
        </button>
        <Popover anchor={plus.current} open={picking} onClose={() => setPicking(false)}>
          <ProjectPicker
            current={null}
            onPick={(id) => {
              assignApp(id, group.app);
              setPicking(false);
            }}
            footer={<span>{t("Всё время в {app} уйдёт в выбранный проект.", { app: appName(group.app) })}</span>}
          />
        </Popover>
      </header>
      <div className="group-rows">
        {group.rows.slice(0, limit).map((r) => (
          <UnsortedRow key={r.context} app={group.app} row={r} hint={hints.get(rowId(group.app, r.context))} />
        ))}
        {group.rows.length > limit && (
          <button type="button" className="row-more" onClick={() => setLimit((l) => l + 20)}>
            {t("Показать ещё {n} из {rest}", { n: Math.min(20, group.rows.length - limit), rest: group.rows.length - limit })}
          </button>
        )}
      </div>
    </section>
  );
}

function UnsortedRow({ app, row, hint }: { app: string; row: Row; hint?: Suggestion }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const projects = useProjects();
  const hp = hint?.projectId ? projects.get(hint.projectId) : undefined;
  return (
    <div className="row" data-open={picking || undefined}>
      <CircleDashed size={17} strokeWidth={1.6} className="row-status" />
      <span className="row-title truncate">{row.context}</span>
      <span className="row-meta">
        {row.days.size > 1 ? t("{n} дн.", { n: row.days.size }) : `${weekday(row.last)} ${dayNum(row.last)}`}
      </span>
      {hp && (
        <button
          type="button"
          className="row-hint"
          style={{ "--c": hp.color } as CSSProperties}
          title={`${hint!.reason} (${Math.round(hint!.confidence * 100)}%)`}
          onClick={() => assign(hp.id, app, row.context)}
        >
          <ProjectIcon project={hp} size={16} />
          {hp.name}
          <Check size={13} />
        </button>
      )}
      {projects.has(PERSONAL.id) && (
        <button type="button" className="row-assign row-assign-quiet" title={t("Не работа: игры, видео, соцсети")} onClick={() => assign(PERSONAL.id, app, row.context)}>
          {t("Личное")}
        </button>
      )}
      <button ref={btn} type="button" className="row-assign" onClick={() => setPicking(true)}>
        {t("Проект")}
      </button>
      <span className="row-dur">{dur(row.ms)}</span>
      <Popover anchor={btn.current} open={picking} onClose={() => setPicking(false)} align="end">
        <ProjectPicker
          current={null}
          onPick={(id) => {
            assign(id, app, row.context);
            setPicking(false);
          }}
        />
      </Popover>
    </div>
  );
}

/** Projects the model spotted in unassigned time (code folders, Figma files) that don't exist yet. */
function NewProjectsCard() {
  const { available, settings } = useSettings();
  const qc = useQueryClient();
  const on = available && settings.aiProvider !== "none";
  const q = useQuery({ queryKey: ["ui.ai_new"], queryFn: () => call<NewProjects | null>("kv_get", { key: "ui.ai_new" }), enabled: on });
  // older runs may hold the same project under two spellings
  const merged = new Map<string, { name: string; keys: string[]; minutes: number; items: NewProjects[string]["items"] }>();
  for (const [name, v] of Object.entries(q.data ?? {})) {
    const k = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const m = merged.get(k);
    if (m) (m.keys.push(name), (m.minutes += v.minutes), m.items.push(...v.items));
    else merged.set(k, { name, keys: [name], minutes: v.minutes, items: [...v.items] });
  }
  const list = [...merged.values()].sort((a, b) => b.minutes - a.minutes);
  const [all, setAll] = useState(false);
  if (!on || !list.length) return null;

  const drop = async (keys: string[]) => {
    const next = { ...(q.data ?? {}) };
    for (const k of keys) delete next[k];
    await call("kv_put", { key: "ui.ai_new", value: next });
    qc.setQueryData(["ui.ai_new"], next);
  };
  const create = async (e: (typeof list)[number]) => {
    const p = actions.addProject(e.name);
    for (const i of e.items) {
      if (i.ctx === appName(i.app)) actions.addRule(p.id, "app", i.app, "equals");
      else actions.addRule(p.id, "context", i.ctx, "equals");
    }
    await drop(e.keys);
  };

  return (
    <section className="card newp">
      <header className="card-head">
        <Sparkles size={14} />
        <span>{t("ИИ нашёл проекты, которых нет в списке")}</span>
      </header>
      {(all ? list : list.slice(0, 6)).map((v) => {
        // where it was seen, without repeating the name itself
        const seen = [...new Set(v.items.map((i) => i.ctx))].filter((c) => c !== v.name).slice(0, 3);
        return (
        <div key={v.name} className="newp-row">
          <FolderPlus size={16} strokeWidth={1.7} className="newp-icon" />
          <span className="newp-main">
            <b>{v.name}</b>
            <span className="muted truncate">{seen.length ? seen.join(" · ") : [...new Set(v.items.map((i) => appName(i.app)))].join(", ")}</span>
          </span>
          <span className="newp-min">{dur(v.minutes * 60_000)}</span>
          <button type="button" className="btn btn-ghost-white" onClick={() => create(v)}>
            <Check size={14} /> {t("Создать")}
          </button>
          <button type="button" className="icon-btn" title={t("Не проект")} onClick={() => drop(v.keys)}>
            <X size={15} />
          </button>
        </div>
        );
      })}
      {list.length > 6 && (
        <button type="button" className="row-more newp-more" onClick={() => setAll((a) => !a)}>
          {all ? t("Свернуть") : t("Ещё {n}", { n: list.length - 6 })}
        </button>
      )}
    </section>
  );
}
