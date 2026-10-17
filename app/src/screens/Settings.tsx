import { useQueryClient } from "@tanstack/react-query";
import { Settings as Gear } from "lucide-react";
import { useState, type ReactNode } from "react";
import { call } from "../data/api";
import { useSaveSettings, useSettings, useStatus, type Settings as S } from "../data/backend";
import { actions } from "../data/store";
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

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, l]) => (
        <button key={v} type="button" data-on={value === v || undefined} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

const lines = (s: string) => s.split("\n").map((x) => x.trim().toLowerCase()).filter(Boolean);

function ago(t: number | null | undefined, now: number) {
  if (!t) return "никогда";
  const s = Math.round((now - t) / 1000);
  if (s < 90) return `${s} с назад`;
  if (s < 5400) return `${Math.round(s / 60)} мин назад`;
  return `${dayTitle(t)}, ${clock(t)}`;
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
        <TopBar icon={<Gear size={14} strokeWidth={1.9} />} section="Настройки" />
        <div className="screen">
          <div className="card error-card">
            <div className="error-title">Бэкенд Tempro не запущен</div>
            <div className="error-hint">Сейчас интерфейс читает только историю ActivityWatch. Запусти приложение: <code>bun run tauri dev</code>.</div>
          </div>
        </div>
      </>
    );
  }
  if (!loaded || !status) return <TopBar icon={<Gear size={14} strokeWidth={1.9} />} section="Настройки" />;

  const now = status.now;
  const c = status.counts;
  const extAlive = now - status.extLastSeen < 90_000;

  return (
    <>
      <TopBar icon={<Gear size={14} strokeWidth={1.9} />} section="Настройки" />
      <div className="screen settings">
        {note && <div className="note">{note}</div>}

        <Section title="Запись" hint="Окна по событиям Windows, ввод только счётчиками, без содержимого нажатий.">
          <Row label="Состояние" hint={`последний сигнал ${ago(status.lastSignal, now)}`}>
            <span className="pill" data-tone={status.paused ? "warn" : "ok"}>{status.paused ? "на паузе" : "идёт запись"}</span>
            <button type="button" className="btn btn-ghost-white" onClick={() => run("pause", () => call("pause_set", { paused: !status.paused }))}>
              {status.paused ? "Продолжить" : "Пауза"}
            </button>
          </Row>
          <Row label="Запускать вместе с Windows" hint="свёрнутым в трей">
            <Toggle on={!!status.autostart} onChange={(v) => run("autostart", () => call("autostart_set", { enabled: v }))} />
          </Row>
          <Row label="Сторож" hint="задача Windows: каждые 5 минут и при входе запускает Tempro, если он не работает; «Выйти» в трее он уважает">
            <span className="pill" data-tone={status.watchdog?.state === "ok" ? "ok" : status.watchdog?.state === "error" ? "warn" : "idle"} title={status.watchdog?.message}>
              {status.watchdog?.state === "ok" ? "включён" : status.watchdog?.state === "error" ? "не удалось включить" : status.watchdog?.state === "dev" ? "только в установленной версии" : "включается…"}
            </span>
          </Row>
          <Row label="Сбои" hint={status.crashLog}>
            {status.crashes?.length ? (
              <span className="crash-list">
                {status.crashes.map((c) => (
                  <code key={c}>{c}</code>
                ))}
              </span>
            ) : (
              <span className="muted">не было</span>
            )}
          </Row>
          <Row label="Отошёл, если нет ввода" hint="короче 5 минут — пауза, дольше — отсутствие">
            <select value={settings.idleSeconds} onChange={(e) => set({ idleSeconds: Number(e.target.value) })}>
              {[60, 120, 180, 300].map((v) => (
                <option key={v} value={v}>{v / 60} мин</option>
              ))}
            </select>
          </Row>
          <Row label="Спрашивать после отсутствия" hint="что это было: встреча, звонок, перерыв">
            <select value={settings.questionMinutes} onChange={(e) => set({ questionMinutes: Number(e.target.value) })}>
              {[10, 15, 30, 60].map((v) => (
                <option key={v} value={v}>от {v} мин</option>
              ))}
            </select>
          </Row>
          <Row label="Горячая клавиша «сейчас работаю над…»" hint="например Ctrl+Alt+T">
            <input className="field" defaultValue={settings.hotkey} onBlur={(e) => e.target.value !== settings.hotkey && set({ hotkey: e.target.value })} />
          </Row>
          <Row label="Собрано" hint={`своих с ${c.firstOwn ? dayTitle(c.firstOwn) : "—"}`}>
            <span className="muted">
              окон {c.windowOwn.toLocaleString("ru-RU")} своих + {c.windowAw.toLocaleString("ru-RU")} из ActivityWatch · звук и микрофон {c.media} · вкладок {c.browser} · снимков текста {c.ocr} · отметок {c.manual}
            </span>
          </Row>
        </Section>

        <Section title="ActivityWatch" hint="История до первого запуска Tempro. Его база только читается.">
          <Row label="Импорт" hint={status.awPath}>
            <span className="muted">
              {status.import?.state === "running"
                ? "идёт…"
                : status.import?.state === "done"
                  ? `готово: +${status.import.window ?? 0} окон, +${status.import.afk ?? 0} отметок присутствия`
                  : status.import?.state === "error"
                    ? status.import.message
                    : status.import?.message ?? "—"}
            </span>
            <button type="button" className="btn btn-ghost-white" disabled={busy === "import"} onClick={() => run("import", async () => {
              await call("import_aw");
              qc.invalidateQueries({ queryKey: ["events"] });
            })}>
              Импортировать
            </button>
          </Row>
          <Row label="Догружать при запуске">
            <Toggle on={settings.importAw} onChange={(v) => set({ importAw: v })} />
          </Row>
        </Section>

        <Section title="Браузер" hint="Расширение присылает адрес и заголовок активной вкладки. Приватные окна не учитываются, параметры адреса отбрасываются.">
          <Row label="Расширение" hint="папка extension/ в проекте → edge://extensions → «Загрузить распакованное»">
            <span className="pill" data-tone={extAlive ? "ok" : "idle"}>{extAlive ? `подключено · ${status.extBrowser}` : `не на связи · ${ago(status.extLastSeen, now)}`}</span>
          </Row>
          <Row label="Порт" hint="127.0.0.1, меняется после перезапуска">
            <input className="field field-narrow" type="number" defaultValue={settings.extPort} onBlur={(e) => Number(e.target.value) !== settings.extPort && set({ extPort: Number(e.target.value) })} />
          </Row>
        </Section>

        <Section
          title="Приватность"
          hint="База зашифрована, ключ лежит в диспетчере учётных данных Windows: скопированный файл без твоей учётной записи не откроется. Скрытие ниже срабатывает ещё до записи."
        >
          <Row label="Хранить подробности" hint="старше — заголовки окон, адреса вкладок и текст с экрана стираются; проект, программа и минуты остаются">
            <select value={settings.detailDays} onChange={(e) => set({ detailDays: Number(e.target.value) })}>
              {[
                [7, "7 дней"],
                [30, "30 дней"],
                [90, "90 дней"],
                [365, "год"],
                [0, "всегда"],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Скрывать заголовки со словами" hint="по одному на строку; заголовок станет «[скрыто]»">
            <textarea className="field" rows={3} defaultValue={settings.hideTitles.join("\n")} onBlur={(e) => set({ hideTitles: lines(e.target.value) })} />
          </Row>
          <Row label="Не хранить заголовки программ" hint="exe по одному на строку, например telegram.exe">
            <textarea className="field" rows={3} defaultValue={settings.hideApps.join("\n")} onBlur={(e) => set({ hideApps: lines(e.target.value) })} />
          </Row>
        </Section>

        <Section title="Текст с экрана" hint="Для программ, у которых заголовок не меняется. Снимок не сохраняется: распознаётся встроенным OCR Windows, в базу идёт только текст.">
          <Row label="Режим">
            <Seg value={settings.screenshots} options={[["never", "Никогда"], ["gaps", "Только для «дыр»"]]} onChange={(v) => set({ screenshots: v })} />
          </Row>
          <Row label="Программы" hint="exe по одному на строку">
            <textarea className="field" rows={3} defaultValue={settings.blindApps.join("\n")} onBlur={(e) => set({ blindApps: lines(e.target.value) })} />
          </Row>
          <Row label="Не чаще" hint="одного снимка на программу">
            <select value={settings.ocrMinutes} onChange={(e) => set({ ocrMinutes: Number(e.target.value) })}>
              {[2, 5, 10, 20].map((v) => (
                <option key={v} value={v}>раз в {v} мин</option>
              ))}
            </select>
          </Row>
          <Row label="Проверка" hint="распознать активное окно сейчас (это окно Tempro)">
            <button type="button" className="btn btn-ghost-white" disabled={busy === "ocr"} onClick={() => run("ocr", async () => {
              const r = await call<{ app: string; text: string }>("ocr_now");
              return `${r.app}: ${r.text || "(текста не найдено)"}`;
            })}>
              Распознать
            </button>
          </Row>
        </Section>

        <Section title="ИИ" hint="Claude Haiku 5.5 по ключу API или локальная модель Ollama. Называет сессии, разбирает время без проекта, пишет сводку дня. Отправляются только заголовки окон и минуты — без снимков и ввода.">
          <Row label="Модель">
            <Seg value={settings.aiProvider} options={[["none", "Выключено"], ["ollama", "Ollama (локально)"], ["claude", "Claude API"]]} onChange={(v) => set({ aiProvider: v })} />
          </Row>
          {settings.aiProvider !== "none" && (
            <Row label="Название модели" hint={settings.aiProvider === "claude" ? "пусто = claude-haiku-5-5 (быстрая и дешёвая)" : "пусто = qwen2.5:7b"}>
              <input className="field" defaultValue={settings.aiModel} onBlur={(e) => set({ aiModel: e.target.value.trim() })} />
            </Row>
          )}
          {settings.aiProvider === "claude" && (
            <>
              <Row label="Адрес API" hint="пусто = api.anthropic.com; для прокси — его адрес с /v1, формат Anthropic или OpenAI определится сам">
                <input className="field" placeholder="https://api.anthropic.com/v1" defaultValue={settings.aiBaseUrl} onBlur={(e) => e.target.value.trim() !== settings.aiBaseUrl && set({ aiBaseUrl: e.target.value.trim() })} />
              </Row>
              <Row label="Ключ API" hint="хранится в диспетчере учётных данных Windows, страница видит только точки">
                <input className="field" type="password" autoComplete="off" defaultValue={settings.aiKey} onBlur={(e) => e.target.value.trim() !== settings.aiKey && set({ aiKey: e.target.value.trim() })} />
              </Row>
            </>
          )}
          {settings.aiProvider !== "none" && (
            <Row label="Проверка" hint="короткий запрос к модели">
              <button type="button" className="btn btn-ghost-white" disabled={busy === "ai"} onClick={() => run("ai", async () => {
                const r = await call<{ ok: boolean; ms: number; format: string }>("ai_check");
                return r.ok ? `ИИ отвечает: ${(r.ms / 1000).toFixed(1)} с, формат ${r.format}` : "Модель ответила, но не так, как ждали";
              })}>
                {busy === "ai" ? "Проверяю…" : "Проверить"}
              </button>
            </Row>
          )}
          {settings.aiProvider !== "none" && (
            <>
              <Row label="Названия сессий" hint="«Макет лендинга Aurora в Figma» вместо заголовка окна">
                <Toggle on={settings.aiTitles} onChange={(v) => set({ aiTitles: v })} />
              </Row>
              <Row label="Авторазбор" hint="раз в полчаса: уверенные ответы сразу становятся правилами ✨, их можно подтвердить или убрать">
                <Toggle on={settings.aiAuto} onChange={(v) => set({ aiAuto: v })} />
              </Row>
            </>
          )}
          {settings.aiProvider === "ollama" && (
            <Row label="Адрес Ollama">
              <input className="field" defaultValue={settings.ollamaUrl} onBlur={(e) => set({ ollamaUrl: e.target.value.trim() })} />
            </Row>
          )}
        </Section>

        <LockSection />

        <Section title="Данные">
          <Row label="База Tempro" hint={status.dbPath}>
            <span className="pill" data-tone={status.encrypted ? "ok" : "idle"}>{status.encrypted ? "зашифрована · SQLCipher" : "не зашифрована"}</span>
          </Row>
          {status.encrypted && (
            <Row label="Ключ восстановления" hint="сохрани в менеджере паролей: без него база не откроется после переустановки Windows">
              {dbKey ? (
                <span className="keybox">
                  <code>{dbKey}</code>
                  <button type="button" className="btn btn-ghost-white" onClick={() => navigator.clipboard?.writeText(dbKey)}>
                    Скопировать
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setDbKey(null)}>
                    Скрыть
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
                        if (String(e instanceof Error ? e.message : e) === "locked") return "Ключ закрыт паролем: открой Tempro в разделе «Пароль» выше.";
                        throw e;
                      }
                    })
                  }
                >
                  Показать
                </button>
              )}
            </Row>
          )}
          <Row label="Сессии Claude Code" hint={status.agentsPath}>
            <span className="muted">читаются, не меняются</span>
          </Row>
          <Row label="Проекты и правила" hint="вернуть стартовый список; часы пересчитаются">
            <button type="button" className="btn btn-ghost-white" onClick={() => confirm("Сбросить проекты и правила к стартовым?") && actions.reset()}>
              Сбросить
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
  const hint =
    "Закрывает журнал или всё окно от того, кто сел за твой компьютер. Запись идёт как обычно. Данные и так зашифрованы и привязаны к твоей учётной записи Windows. Окно закрывается снова, когда ты его прячешь или блокируешь Windows; сразу — Ctrl+L.";

  return (
    <Section title="Пароль" hint={hint}>
      {msg && <div className={msg.ok ? "note note-ok" : "note"}>{msg.text}</div>}
      {!status.set ? (
        <>
          <Row label="Что закрыть" hint="что будет спрашивать пароль">
            <span className="lock-opts">
              <label>
                <Toggle on={journal} onChange={setJournal} /> журнал
              </label>
              <label>
                <Toggle on={app} onChange={setApp} /> всё приложение
              </label>
            </span>
          </Row>
          <Row label="Новый пароль" hint="хотя бы 4 символа; забудешь — снимешь ключом восстановления">
            <span className="lock-fields">
              <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Пароль" autoComplete="new-password" />
              <input className="field" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Ещё раз" autoComplete="new-password" data-bad={mismatch || undefined} />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || pw.length < 4 || pw !== pw2 || (!journal && !app)}
                onClick={() => act(() => lock.set({ password: pw, journal, app }), "Пароль задан")}
              >
                Задать
              </button>
            </span>
          </Row>
        </>
      ) : !status.unlocked ? (
        <div className="lock-inline">
          <UnlockForm title="Открой, чтобы изменить" hint="Настройки пароля доступны после ввода пароля." />
        </div>
      ) : (
        <>
          <Row label="Журнал" hint="сырые события: каждое окно и вкладка">
            <Toggle on={status.journal} onChange={(v) => act(() => lock.set({ journal: v, app: status.app }), v ? "Журнал закрыт паролем" : "Журнал открыт")} />
          </Row>
          <Row label="Всё приложение" hint="окно спрашивает пароль, когда его открывают из трея">
            <Toggle on={status.app} onChange={(v) => act(() => lock.set({ journal: status.journal, app: v }), v ? "Всё приложение под паролем" : "Приложение открыто")} />
          </Row>
          <Row label="Сменить пароль">
            <span className="lock-fields">
              <input className="field" type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Текущий" autoComplete="current-password" />
              <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Новый" autoComplete="new-password" />
              <input className="field" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Ещё раз" autoComplete="new-password" data-bad={mismatch || undefined} />
              <button
                type="button"
                className="btn btn-ghost-white"
                disabled={busy || !cur || pw.length < 4 || pw !== pw2}
                onClick={() => act(() => lock.set({ current: cur, password: pw, journal: status.journal, app: status.app }), "Пароль сменён")}
              >
                Сменить
              </button>
            </span>
          </Row>
          <Row label="Убрать пароль" hint="введи текущий пароль в «Сменить пароль» и нажми">
            <button type="button" className="btn btn-ghost-white" disabled={busy || !cur} onClick={() => act(() => lock.set({ current: cur, password: "", journal: false, app: false }), "Пароль убран")}>
              Убрать
            </button>
          </Row>
          <Row label="Заблокировать сейчас" hint="Ctrl+L">
            <button type="button" className="btn btn-ghost-white" onClick={() => void lock.lock()}>
              Заблокировать
            </button>
          </Row>
        </>
      )}
    </Section>
  );
}
