import { t } from "../lib/i18n";

export function Loading() {
  return (
    <div className="loading" aria-busy>
      <div className="skeleton skeleton-tl" />
      <div className="split">
        <div className="split-list">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton skeleton-card" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
        <div className="split-stack">
          <div className="skeleton skeleton-stack" />
        </div>
      </div>
    </div>
  );
}

export function LoadError({ error }: { error: Error }) {
  return (
    <div className="error-card card">
      <div className="error-title">{t("Не получилось прочитать данные ActivityWatch")}</div>
      <div className="error-text">{error.message}</div>
      <div className="error-hint">{t("Проверь, что ActivityWatch установлен и база лежит в %LOCALAPPDATA%\\activitywatch.")}</div>
    </div>
  );
}
