import { Archive, ArchiveRestore, Check, Sparkles, Wand2, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { actions, useStore } from "../data/store";
import { appName } from "../engine/context";
import { KIND_LABEL, KINDS, kindOf, PALETTE } from "../engine/rules";
import type { Project, Rule } from "../engine/types";
import { ICONS, iconOf } from "../engine/icons";
import { ICON_COMPONENT } from "./ProjectIcon";

const FIELD_LABEL: Record<Rule["field"], string> = { app: "программа", title: "заголовок", context: "документ", url: "адрес", path: "папка", any: "везде" };

/** Name, colour, rules, archive: everything about how time finds this project. */
export function ProjectSettings({ p }: { p: Project }) {
  const { rules } = useStore();
  const own = rules.filter((r) => r.projectId === p.id).sort((a, b) => (a.source === "ai" ? -1 : 0) - (b.source === "ai" ? -1 : 0));
  const [kw, setKw] = useState("");
  const ai = own.filter((r) => r.source === "ai");
  const current = iconOf(p, rules);

  return (
    <section className="card psettings">
      <header className="card-head">Как время попадает в проект</header>
      <div className="ps-row">
        <span className="ps-label">Название</span>
        <input
          className="field"
          defaultValue={p.name}
          key={p.id}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.name && actions.updateProject(p.id, { name: e.target.value.trim() })}
        />
      </div>
      <div className="ps-row">
        <span className="ps-label">Цвет</span>
        <div className="ps-swatches">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              aria-label={c}
              data-on={c === p.color || undefined}
              style={{ "--c": c } as CSSProperties}
              onClick={() => actions.updateProject(p.id, { color: c })}
            />
          ))}
        </div>
      </div>
      <div className="ps-row ps-icons-row">
        <span className="ps-label">Иконка</span>
        <div className="ps-icons">
          <button type="button" className="ps-icon-auto" data-on={!p.icon || undefined} onClick={() => actions.updateProject(p.id, { icon: undefined })} title="Подбирается по названию и правилам">
            <Wand2 size={13} /> Авто
          </button>
          {ICONS.map((name) => {
            const Icon = ICON_COMPONENT[name];
            return (
              <button
                key={name}
                type="button"
                className="ps-icon"
                data-on={current === name || undefined}
                data-auto={(!p.icon && current === name) || undefined}
                style={{ "--c": p.color } as CSSProperties}
                aria-label={name}
                onClick={() => actions.updateProject(p.id, { icon: name })}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="ps-row">
        <span className="ps-label">Вид</span>
        <div className="segmented segmented-sm">
          {KINDS.map((k) => (
            <button key={k} type="button" data-on={kindOf(p) === k || undefined} onClick={() => actions.updateProject(p.id, { kind: k })}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      {ai.length > 0 && (
        <div className="ps-row ps-ai">
          <span className="ps-label">
            <Sparkles size={13} /> ИИ отнёс сюда
          </span>
          <div className="rules">
            {ai.map((r) => (
              <span key={r.id} className="rule rule-ai" title={r.fallback ? "Общее правило: берёт только то, что не подошло ни под один проект" : undefined}>
                <span className="rule-field">{FIELD_LABEL[r.field]}</span>
                {r.op === "equals" ? "=" : "∋"}
                <span className="rule-value truncate">{r.field === "app" ? appName(r.value) : r.value}</span>
                <button type="button" title="Верно" onClick={() => actions.confirmRule(r.id)}>
                  <Check size={12} />
                </button>
                <button type="button" title="Неверно — убрать" onClick={() => actions.removeRule(r.id)}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="ps-row ps-rules">
        <span className="ps-label">Правила</span>
        <div className="ps-rules-body">
          <div className="rules">
            {own
              .filter((r) => r.source !== "ai")
              .map((r) => (
                <span key={r.id} className="rule" data-user={r.source === "user" || undefined} title={r.source === "user" ? "Твоё правило" : "Встроенное правило"}>
                  <span className="rule-field">{FIELD_LABEL[r.field]}</span>
                  {r.op === "equals" ? "=" : "∋"}
                  <span className="rule-value truncate">{r.field === "app" ? appName(r.value) : r.value}</span>
                  <button type="button" aria-label="Удалить правило" onClick={() => actions.removeRule(r.id)}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            {own.length === 0 && <span className="muted">Правил нет: время попадёт сюда только вручную или через ИИ</span>}
          </div>
          <form
            className="rule-add"
            onSubmit={(e) => {
              e.preventDefault();
              actions.addRule(p.id, "any", kw);
              setKw("");
            }}
          >
            <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="+ слово из заголовка, адреса или папки и Enter" />
          </form>
        </div>
      </div>
      <div className="ps-row">
        <span className="ps-label">Архив</span>
        <button type="button" className="btn btn-ghost-white" onClick={() => actions.updateProject(p.id, { archived: !p.archived })}>
          {p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {p.archived ? "Вернуть из архива" : "В архив — правила перестанут срабатывать"}
        </button>
      </div>
    </section>
  );
}
