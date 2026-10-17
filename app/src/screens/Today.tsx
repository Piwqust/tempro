import { useEffect, useState } from "react";
import { useTitles } from "../data/ai";
import { SHORT_SESSION_MS } from "../engine/compute";
import { useModel, useProjects } from "../data/useModel";
import { pl, t } from "../lib/i18n";
import { addDays } from "../lib/time";
import { useNav } from "../nav";
import { DayTimeline } from "../ui/DayTimeline";
import { FilterBar, useFilter } from "../ui/FilterBar";
import { Breakdown, Hero, Kinds, Leisure } from "../ui/Overview";
import { Questions } from "../ui/Questions";
import { SessionList } from "../ui/SessionList";
import { PeriodBar } from "../ui/PeriodBar";
import { Loading, LoadError } from "./states";

export function Today() {
  const { nav, go } = useNav();
  const day = nav.day;
  const { model, error, loading } = useModel(day, addDays(day, 1));
  const projects = useProjects();
  const visible = useFilter();
  const filtered = nav.projectFilter.length > 0 || nav.appFilter.length > 0;
  const [selected, setSelected] = useState<string | null>(null);
  const titles = useTitles(model);

  useEffect(() => setSelected(null), [day]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleProject = (id: string) => go({ projectFilter: nav.projectFilter.length === 1 && nav.projectFilter[0] === id ? [] : [id] });

  const sessions = model?.sessions.filter((s) => (filtered || s.active >= SHORT_SESSION_MS) && s.apps.some((a) => visible(s.projectId, a))) ?? [];
  const longCount = model?.sessions.filter((s) => s.active >= SHORT_SESSION_MS).length ?? 0;

  return (
    <>
      <PeriodBar gran="day" />
      <div className="screen">
        {error ? (
          <LoadError error={error} />
        ) : loading || !model ? (
          <Loading />
        ) : (
          <>
            <Hero model={model} projects={projects} day={day} />
            <Questions questions={model.questions} />
            <DayTimeline model={model} projects={projects} visible={visible} selected={selected} onSelect={setSelected} titles={titles} />
            <div className="today-grid">
              <section className="card today-sessions">
                <header className="card-head">
                  <span>{t("Сессии")}</span>
                  <span className="muted">
                    {longCount} {pl(longCount, ["сессия", "сессии", "сессий"], ["session", "sessions"])}
                  </span>
                  <div className="card-head-right">
                    <FilterBar model={model} compact />
                  </div>
                </header>
                <SessionList
                  sessions={sessions}
                  projects={projects}
                  selected={selected}
                  onSelect={setSelected}
                  titles={titles}
                  empty={model.sessions.length ? t("Под фильтр ничего не попало") : t("За этот день нет активности")}
                />
              </section>
              <div className="today-side">
                <Kinds totals={model.byProject} projects={projects} active={nav.projectFilter} onPick={(ids) => go({ projectFilter: ids })} />
                <Breakdown totals={model.byProject} projects={projects} active={nav.projectFilter} onToggle={toggleProject} />
                <Leisure model={model} projects={projects} />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
