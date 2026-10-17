import { useQueryClient } from "@tanstack/react-query";
import { Settings as Gear } from "lucide-react";
import { useState, type ReactNode } from "react";
import { call } from "../data/api";
import { useSaveSettings, useSettings, useStatus, type Settings as S } from "../data/backend";
import { actions } from "../data/store";
import { langSetting, locale, num, setLang, t, tj } from "../lib/i18n";
import { clock, dayTitle } from "../lib/time";
import { TopBar } from "../ui/TopBar";
import { UnlockForm, useLock } from "../ui/Lock";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card set-section">
      <header className="set-head">
        <span className="set-title">{title}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </header>
      <div className="set-body">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" className="toggle" data-on={on || undefined} role="switch" aria-checked={on} onClick={() => onChange(!on)} />;
}

// a handful of fixed choices reads better as segments than as the system's dropdown,
// which looked foreign next to Tempro's own menus
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" data-on={value === v || undefined} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

const lines = (s: string) => s.split("\n").map((x) => x.trim().toLowerCase()).filter(Boolean);

function ago(ts: number | null | undefined, now: number) {
  if (!ts) return t("никогда");
  const s = Math.round((now - ts) / 1000);
  if (s < 90) return t("{n} с назад", { n: s });
  if (s < 5400) return t("{n} мин назад", { n: Math.round(s / 60) });
  return `${dayTitle(ts)}, ${clock(ts)}`;
}

export function Settings() {
  const { settings, loaded, available } = useSettings();
  const save = useSaveSettings();
  const status = useStatus().data;
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dbKey, setDbKey] = useState<string | null>(null);
  const set = (patch: Partial<S>) => save.mutate(patch);
  const pickLang = async (v: "auto" | "ru" | "en") => {
    try {
      await save.mutateAsync({ lang: v });
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e));
      return;
    }
    setLang(v);
  };

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setNote(null);
    try {
      const r = await fn();
      if (typeof r === "string") setNote(r);
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["status"] });
    }
  };

  if (!available) {
    return (
      <>
        <TopBar icon={<Gear size={14} strokeWidth={1.9} />} section={t("Настройки")} />
        <div className="screen">
          <div className="card error-card">
            <div className="error-title">{t("Бэкенд Tempro не запущен")}</div>
            <div className="error-hint">{tj("Сейчас интерфейс читает только историю ActivityWatch. Запусти приложение: {cmd}.", { cmd: <code>bun run tauri dev</code> })}</div>
          </div>
        </div>
      </>
    );
  }
  if (!loaded || !status) return <TopBar icon={<Gear size={14} strokeWidth={1.9} />} section={t("Настройки")} />;

  const now = status.now;
  const c = status.counts;
  const extAlive = now - status.extLastSeen < 90_000;

  return (
    <>
      <TopBar icon={<Gear size={14} strokeWidth={1.9} />} section={t("Настройки")} />
      <div className="screen settings">
        {note && <div className="note">{note}</div>}

        <Section title={t("Язык")}>
          <Row label={t("Язык")} hint={t("Интерфейс, меню в трее и ответы ИИ")}>
            <Seg value={langSetting()} options={[["auto", t("Как в системе")], ["ru", "Русский"], ["en", "English"]]} onChange={(v) => void pickLang(v)} />
          </Row>
        </Section>

        <Section title={t("Запись")} hint={t("Окна по событиям Windows, ввод только счётчиками, без содержимого нажатий.")}>
          <Row label={t("Состояние")} hint={t("последний сигнал {ago}", { ago: ago(status.lastSignal, now) })}>
            <span className="pill" data-tone={status.paused ? "warn" : "ok"}>{status.paused ? t("на паузе") : t("идёт запись")}</span>
            <button type="button" className="btn btn-ghost-white" onClick={() => run("pause", () => call("pause_set", { paused: !status.paused }))}>
              {status.paused ? t("Продолжить") : t("Пауза")}
            </button>
          </Row>
          <Row label={t("Запускать вместе с Windows")} hint={t("свёрнутым в трей")}>
            <Toggle on={!!status.autostart} onChange={(v) => run("autostart", () => call("autostart_set", { enabled: v }))} />
          </Row>
          <Row label={t("Сторож")} hint={t("задача Windows: каждые 5 минут и при входе запускает Tempro, если он не работает; «Выйти» в трее он уважает")}>
            <span className="pill" data-tone={status.watchdog?.state === "ok" ? "ok" : status.watchdog?.state === "error" ? "warn" : "idle"} title={status.watchdog?.message}>
              {status.watchdog?.state === "ok" ? t("включён") : status.watchdog?.state === "error" ? t("не удалось включить") : status.watchdog?.state === "dev" ? t("только в установленной версии") : t("включается…")}
            </span>
          </Row>
          <Row label={t("Сбои")} hint={status.crashLog}>
            {status.crashes?.length ? (
              <span className="crash-list">
                {status.crashes.map((c) => (
                  <code key={c}>{c}</code>
                ))}
              </span>
            ) : (
              <span className="muted">{t("не было")}</span>
            )}
          </Row>
          <Row label={t("Отошёл, если нет ввода")} hint={t("короче 5 минут — пауза, дольше — отсутствие")}>
            <Seg value={settings.idleSeconds} options={[60, 120, 180, 300].map((v) => [v, t("{n} мин", { n: v / 60 })])} onChange={(v) => set({ idleSeconds: v })} />
          </Row>
          <Row label={t("Спрашивать после отсутствия")} hint={t("что это было: встреча, звонок, перерыв")}>
            <Seg value={settings.questionMinutes} options={[10, 15, 30, 60].map((v) => [v, t("{n} мин", { n: v })])} onChange={(v) => set({ questionMinutes: v })} />
          </Row>
          <Row label={t("Горячая клавиша «сейчас работаю над…»")} hint={t("например Ctrl+Alt+T")}>
            <input className="field" defaultValue={settings.hotkey} onBlur={(e) => e.target.value !== settings.hotkey && set({ hotkey: e.target.value })} />
          </Row>
          <Row label={t("Собрано")} hint={t("своих с {day}", { day: c.firstOwn ? dayTitle(c.firstOwn) : "—" })}>
            <span className="muted">
              {t("окон {own} своих + {aw} из ActivityWatch · звук и микрофон {media} · вкладок {browser} · снимков текста {ocr} · отметок {manual}", {
                own: c.windowOwn.toLocaleString(locale()),
                aw: c.windowAw.toLocaleString(locale()),
                media: c.media,
                browser: c.browser,
                ocr: c.ocr,
                manual: c.manual,
              })}
            </span>
          </Row>
        </Section>

        <Section title="ActivityWatch" hint={t("История до первого запуска Tempro. Его база только читается.")}>
          <Row label={t("Импорт")} hint={status.awPath}>
            <span className="muted">
              {status.import?.state === "running"
                ? t("идёт…")
                : status.import?.state === "done"
                  ? t("готово: +{w} окон, +{a} отметок присутствия", { w: status.import.window ?? 0, a: status.import.afk ?? 0 })
                  : status.import?.state === "error"
                    ? status.import.message
                    : status.import?.message ?? "—"}
            </span>
            <button type="button" className="btn btn-ghost-white" disabled={busy === "import"} onClick={() => run("import", async () => {
              await call("import_aw");
              qc.invalidateQueries({ queryKey: ["events"] });
            })}>
              {t("Импортировать")}
            </button>
          </Row>
          <Row label={t("Догружать при запуске")}>
            <Toggle on={settings.importAw} onChange={(v) => set({ importAw: v })} />
          </Row>
        </Section>

        <Section title={t("Браузер")} hint={t("Расширение присылает адрес и заголовок активной вкладки. Приватные окна не учитываются, параметры адреса отбрасываются.")}>
          <Row label={t("Расширение")} hint={t("папка extension/ в проекте → edge://extensions → «Загрузить распакованное»")}>
            <span className="pill" data-tone={extAlive ? "ok" : "idle"}>{extAlive ? t("подключено · {b}", { b: status.extBrowser }) : t("не на связи · {ago}", { ago: ago(status.extLastSeen, now) })}</span>
          </Row>
          <Row label={t("Порт")} hint={t("127.0.0.1, меняется после перезапуска")}>
            <input className="field field-narrow" type="number" defaultValue={settings.extPort} onBlur={(e) => Number(e.target.value) !== settings.extPort && set({ extPort: Number(e.target.value) })} />
          </Row>
        </Section>

        <Section
          title={t("Приватность")}
          hint={t("База зашифрована, ключ лежит в диспетчере учётных данных Windows: скопированный файл без твоей учётной записи не откроется. Скрытие ниже срабатывает ещё до записи.")}
        >
          <Row label={t("Хранить подробности")} hint={t("старше — заголовки окон, адреса вкладок и текст с экрана стираются; проект, программа и минуты остаются")}>
            <Seg
              value={settings.detailDays}
              options={[
                [7, t("7 дней")],
                [30, t("30 дней")],
                [90, t("90 дней")],
                [365, t("год")],
                [0, t("всегда")],
              ]}
              onChange={(v) => set({ detailDays: v })}
            />
          </Row>
          <Row label={t("Скрывать заголовки со словами")} hint={t("по одному на строку; заголовок станет «[скрыто]»")}>
            <textarea className="field" rows={3} defaultValue={settings.hideTitles.join("\n")} onBlur={(e) => set({ hideTitles: lines(e.target.value) })} />
          </Row>
          <Row label={t("Не хранить заголовки программ")} hint={t("exe по одному на строку, например telegram.exe")}>
            <textarea className="field" rows={3} defaultValue={settings.hideApps.join("\n")} onBlur={(e) => set({ hideApps: lines(e.target.value) })} />
          </Row>
        </Section>

        <Section title={t("Текст с экрана")} hint={t("Для программ, у которых заголовок не меняется. Снимок не сохраняется: распознаётся встроенным OCR Windows, в базу идёт только текст.")}>
          <Row label={t("Режим")}>
            <Seg value={settings.screenshots} options={[["never", t("Никогда")], ["gaps", t("Только для «дыр»")]]} onChange={(v) => set({ screenshots: v })} />
          </Row>
          <Row label={t("Программы")} hint={t("exe по одному на строку")}>
            <textarea className="field" rows={3} defaultValue={settings.blindApps.join("\n")} onBlur={(e) => set({ blindApps: lines(e.target.value) })} />
          </Row>
          <Row label={t("Не чаще")} hint={t("одного снимка на программу")}>
            <Seg value={settings.ocrMinutes} options={[2, 5, 10, 20].map((v) => [v, t("{n} мин", { n: v })])} onChange={(v) => set({ ocrMinutes: v })} />
          </Row>
          <Row label={t("Проверка")} hint={t("распознать активное окно сейчас (это окно Tempro)")}>
            <button type="button" className="btn btn-ghost-white" disabled={busy === "ocr"} onClick={() => run("ocr", async () => {
              const r = await call<{ app: string; text: string }>("ocr_now");
              return `${r.app}: ${r.text || t("(текста не найдено)")}`;
            })}>
              {t("Распознать")}
            </button>
          </Row>
        </Section>

        <Section title={t("ИИ")} hint={t("Claude Haiku 5.5 по ключу API или локальная модель Ollama. Называет сессии, разбирает время без проекта, пишет сводку дня. Отправляются только заголовки окон и минуты — без снимков и ввода.")}>
          <Row label={t("Модель")}>
            <Seg value={settings.aiProvider} options={[["none", t("Выключено")], ["ollama", t("Ollama (локально)")], ["claude", "Claude API"]]} onChange={(v) => set({ aiProvider: v })} />
          </Row>
          {settings.aiProvider !== "none" && (
            <Row label={t("Название модели")} hint={settings.aiProvider === "claude" ? t("пусто = claude-haiku-5-5 (быстрая и дешёвая)") : t("пусто = qwen2.5:7b")}>
              <input className="field" defaultValue={settings.aiModel} onBlur={(e) => set({ aiModel: e.target.value.trim() })} />
            </Row>
          )}
          {settings.aiProvider === "claude" && (
            <>
              <Row label={t("Адрес API")} hint={t("пусто = api.anthropic.com; для прокси — его адрес с /v1, формат Anthropic или OpenAI определится сам")}>
                <input className="field" placeholder="https://api.anthropic.com/v1" defaultValue={settings.aiBaseUrl} onBlur={(e) => e.target.value.trim() !== settings.aiBaseUrl && set({ aiBaseUrl: e.target.value.trim() })} />
              </Row>
              <Row label={t("Ключ API")} hint={t("хранится в диспетчере учётных данных Windows, страница видит только точки")}>
                <input className="field" type="password" autoComplete="off" defaultValue={settings.aiKey} onBlur={(e) => e.target.value.trim() !== settings.aiKey && set({ aiKey: e.target.value.trim() })} />
              </Row>
            </>
          )}
          {settings.aiProvider !== "none" && (
            <Row label={t("Проверка")} hint={t("короткий запрос к модели")}>
              <button type="button" className="btn btn-ghost-white" disabled={busy === "ai"} onClick={() => run("ai", async () => {
                const r = await call<{ ok: boolean; ms: number; format: string }>("ai_check");
                return r.ok ? t("ИИ отвечает: {s} с, формат {format}", { s: num((r.ms / 1000).toFixed(1)), format: r.format }) : t("Модель ответила, но не так, как ждали");
              })}>
                {busy === "ai" ? t("Проверяю…") : t("Проверить")}
              </button>
            </Row>
          )}
          {settings.aiProvider !== "none" && (
            <>
              <Row label={t("Названия сессий")} hint={t("«Макет лендинга Aurora в Figma» вместо заголовка окна")}>
                <Toggle on={settings.aiTitles} onChange={(v) => set({ aiTitles: v })} />
              </Row>
              <Row label={t("Авторазбор")} hint={t("раз в полчаса: уверенные ответы сразу становятся правилами ✨, их можно подтвердить или убрать")}>
                <Toggle on={settings.aiAuto} onChange={(v) => set({ aiAuto: v })} />
              </Row>
            </>
          )}
          {settings.aiProvider === "ollama" && (
            <Row label={t("Адрес Ollama")}>
              <input className="field" defaultValue={settings.ollamaUrl} onBlur={(e) => set({ ollamaUrl: e.target.value.trim() })} />
            </Row>
          )}
        </Section>

        <LockSection />

        <Section title={t("Данные")}>
          <Row label={t("База Tempro")} hint={status.dbPath}>
            <span className="pill" data-tone={status.encrypted ? "ok" : "idle"}>{status.encrypted ? t("зашифрована · SQLCipher") : t("не зашифрована")}</span>
          </Row>
          {status.encrypted && (
            <Row label={t("Ключ восстановления")} hint={t("сохрани в менеджере паролей: без него база не откроется после переустановки Windows")}>
              {dbKey ? (
                <span className="keybox">
                  <code>{dbKey}</code>
                  <button type="button" className="btn btn-ghost-white" onClick={() => navigator.clipboard?.writeText(dbKey)}>
                    {t("Скопировать")}
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setDbKey(null)}>
                    {t("Скрыть")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost-white"
                  onClick={() =>
                    run("key", async () => {
                      try {
                        setDbKey(await call<string>("db_key"));
                      } catch (e) {
                        if (String(e instanceof Error ? e.message : e) === "locked") return t("Ключ закрыт паролем: открой Tempro в разделе «Пароль» выше.");
                        throw e;
                      }
                    })
                  }
                >
                  {t("Показать")}
                </button>
              )}
            </Row>
          )}
          <Row label={t("Сессии Claude Code")} hint={status.agentsPath}>
            <span className="muted">{t("читаются, не меняются")}</span>
          </Row>
          <Row label={t("Проекты и правила")} hint={t("вернуть стартовый список; часы пересчитаются")}>
            <button type="button" className="btn btn-ghost-white" onClick={() => confirm(t("Сбросить проекты и правила к стартовым?")) && actions.reset()}>
              {t("Сбросить")}
            </button>
          </Row>
        </Section>
      </div>
    </>
  );
}

/** A password for the journal or the whole window. Changing or removing it needs the current one;
 *  switching what it guards needs the window unlocked. */
function LockSection() {
  const lock = useLock();
  const { status } = lock;
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [journal, setJournal] = useState(true);
  const [app, setApp] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setCur("");
      setPw("");
      setPw2("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const mismatch = pw2.length > 0 && pw !== pw2;
  const hint = t(
    "Закрывает журнал или всё окно от того, кто сел за твой компьютер. Запись идёт как обычно. Данные и так зашифрованы и привязаны к твоей учётной записи Windows. Окно закрывается снова, когда ты его прячешь или блокируешь Windows; сразу — Ctrl+L.",
  );

  return (
    <Section title={t("Пароль")} hint={hint}>
      {msg && <div className={msg.ok ? "note note-ok" : "note"}>{msg.text}</div>}
      {!status.set ? (
        <>
          <Row label={t("Что закрыть")} hint={t("что будет спрашивать пароль")}>
            <span className="lock-opts">
              <label>
                <Toggle on={journal} onChange={setJournal} /> {t("журнал")}
              </label>
              <label>
                <Toggle on={app} onChange={setApp} /> {t("всё приложение")}
              </label>
            </span>
          </Row>
          <Row label={t("Новый пароль")} hint={t("хотя бы 4 символа; забудешь — снимешь ключом восстановления")}>
            <span className="lock-fields">
              <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t("Пароль")} autoComplete="new-password" />
              <input className="field" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder={t("Ещё раз")} autoComplete="new-password" data-bad={mismatch || undefined} />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || pw.length < 4 || pw !== pw2 || (!journal && !app)}
                onClick={() => act(() => lock.set({ password: pw, journal, app }), t("Пароль задан"))}
              >
                {t("Задать")}
              </button>
            </span>
          </Row>
        </>
      ) : !status.unlocked ? (
        <div className="lock-inline">
          <UnlockForm title={t("Открой, чтобы изменить")} hint={t("Настройки пароля доступны после ввода пароля.")} />
        </div>
      ) : (
        <>
          <Row label={t("Журнал")} hint={t("сырые события: каждое окно и вкладка")}>
            <Toggle on={status.journal} onChange={(v) => act(() => lock.set({ journal: v, app: status.app }), v ? t("Журнал закрыт паролем") : t("Журнал открыт"))} />
          </Row>
          <Row label={t("Всё приложение")} hint={t("окно спрашивает пароль, когда его открывают из трея")}>
            <Toggle on={status.app} onChange={(v) => act(() => lock.set({ journal: status.journal, app: v }), v ? t("Всё приложение под паролем") : t("Приложение открыто"))} />
          </Row>
          <Row label={t("Сменить пароль")}>
            <span className="lock-fields">
              <input className="field" type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder={t("Текущий")} autoComplete="current-password" />
              <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t("Новый")} autoComplete="new-password" />
              <input className="field" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder={t("Ещё раз")} autoComplete="new-password" data-bad={mismatch || undefined} />
              <button
                type="button"
                className="btn btn-ghost-white"
                disabled={busy || !cur || pw.length < 4 || pw !== pw2}
                onClick={() => act(() => lock.set({ current: cur, password: pw, journal: status.journal, app: status.app }), t("Пароль сменён"))}
              >
                {t("Сменить")}
              </button>
            </span>
          </Row>
          <Row label={t("Убрать пароль")} hint={t("введи текущий пароль в «Сменить пароль» и нажми")}>
            <button type="button" className="btn btn-ghost-white" disabled={busy || !cur} onClick={() => act(() => lock.set({ current: cur, password: "", journal: false, app: false }), t("Пароль убран"))}>
              {t("Убрать")}
            </button>
          </Row>
          <Row label={t("Заблокировать сейчас")} hint="Ctrl+L">
            <button type="button" className="btn btn-ghost-white" onClick={() => void lock.lock()}>
              {t("Заблокировать")}
            </button>
          </Row>
        </>
      )}
    </Section>
  );
}
