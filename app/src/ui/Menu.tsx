import { Check, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";

export type MenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  checked?: boolean;
  /** visual separator above this item */
  divider?: boolean;
};

type Props = {
  items: MenuItem[];
  onPick: (id: string) => void;
  placeholder?: string;
  /** when set, an extra "create" row appears for unmatched queries */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  checkboxes?: boolean;
  footer?: ReactNode;
};

/** Command-style list: type to filter, arrows to move, Enter to pick. */
export function Menu({ items, onPick, placeholder = t("Поиск…"), onCreate, createLabel, checkboxes, footer }: Props) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.label.toLowerCase().includes(s)) : items;
  }, [items, q]);
  const canCreate = !!onCreate && q.trim() !== "" && !items.some((i) => i.label.toLowerCase() === q.trim().toLowerCase());
  const total = shown.length + (canCreate ? 1 : 0);

  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const pick = (i: number) => {
    if (i < shown.length) onPick(shown[i].id);
    else if (canCreate) onCreate!(q.trim());
  };

  return (
    // period keys must not fire while typing a filter, but Escape has to reach the popover to close it
    <div className="menu" onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}>
      <label className="menu-search">
        <Search size={15} strokeWidth={1.75} />
        <input
          ref={input}
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(total - 1, h + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
            else if (e.key === "Enter") (e.preventDefault(), pick(hi));
          }}
        />
      </label>
      <div className="menu-list" ref={list}>
        {shown.map((it, i) => (
          <div key={it.id}>
            {it.divider && !q && <div className="menu-divider" />}
            <button
              type="button"
              data-i={i}
              className="menu-item"
              data-active={i === hi || undefined}
              onMouseMove={() => setHi(i)}
              onClick={() => pick(i)}
            >
              {checkboxes && (
                <span className="checkbox" data-on={it.checked || undefined}>
                  {it.checked && <Check size={11} strokeWidth={3} />}
                </span>
              )}
              {it.icon && <span className="menu-icon">{it.icon}</span>}
              <span className="menu-label">{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
              {!checkboxes && it.checked && <Check size={14} className="menu-check" />}
            </button>
          </div>
        ))}
        {canCreate && (
          <button
            type="button"
            data-i={shown.length}
            className="menu-item"
            data-active={hi === shown.length || undefined}
            onMouseMove={() => setHi(shown.length)}
            onClick={() => pick(shown.length)}
          >
            <span className="menu-icon">
              <Plus size={15} />
            </span>
            <span className="menu-label">{createLabel ? createLabel(q.trim()) : t("Создать «{name}»", { name: q.trim() })}</span>
          </button>
        )}
        {total === 0 && <div className="menu-empty">{t("Ничего не найдено")}</div>}
      </div>
      {footer && <div className="menu-footer">{footer}</div>}
    </div>
  );
}
