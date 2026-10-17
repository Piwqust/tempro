import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;
  section: string;
  title?: ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  right?: ReactNode;
};

export function TopBar({ icon, section, title, onPrev, onNext, nextDisabled, right }: Props) {
  return (
    <header className="topbar">
      {(onPrev || onNext) && (
        <div className="topbar-arrows">
          <button type="button" className="icon-btn" onClick={onPrev} aria-label="Назад" title="Назад  [">
            <ArrowLeft size={18} strokeWidth={1.6} />
          </button>
          <button type="button" className="icon-btn" onClick={onNext} disabled={nextDisabled} aria-label="Вперёд" title="Вперёд  ]">
            <ArrowRight size={18} strokeWidth={1.6} />
          </button>
        </div>
      )}
      <div className="crumbs">
        <span className="crumb-icon">{icon}</span>
        <span className="crumb">{section}</span>
        {title && (
          <>
            <ChevronRight size={15} className="crumb-sep" />
            <span className="crumb crumb-current">{title}</span>
          </>
        )}
      </div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}
