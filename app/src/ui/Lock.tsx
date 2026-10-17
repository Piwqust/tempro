import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock as LockIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { call } from "../data/api";
import { useBackend } from "../data/backend";
import { Logo } from "./Logo";

export type LockStatus = { set: boolean; journal: boolean; app: boolean; unlocked: boolean };
const OPEN: LockStatus = { set: false, journal: false, app: false, unlocked: true };

export function useLock() {
  const has = useBackend().data;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lock"], queryFn: () => call<LockStatus>("lock_status"), enabled: has === true, staleTime: Infinity });
  // the backend locks again when the window is hidden or Windows is locked
  useEffect(() => {
    const again = () => void qc.invalidateQueries({ queryKey: ["lock"] });
    const locked = () => {
      // what the journal showed must not survive the lock in memory
      qc.removeQueries({ queryKey: ["journal"] });
      again();
    };
    window.addEventListener("focus", again);
    const off = isTauri() ? listen("locked", locked) : null;
    return () => {
      window.removeEventListener("focus", again);
      off?.then((f) => f());
    };
  }, [qc]);
  const status = q.data ?? OPEN;
  const refresh = () => qc.invalidateQueries({ queryKey: ["lock"] });
  return {
    status,
    loaded: has === false || q.isSuccess,
    /** the whole window waits for the password */
    appLocked: status.set && status.app && !status.unlocked,
    journalLocked: status.set && (status.journal || status.app) && !status.unlocked,
    unlock: async (password: string) => {
      const ok = await call<boolean>("lock_unlock", { password });
      if (ok) {
        await refresh();
        void qc.invalidateQueries({ queryKey: ["journal"] });
      }
      return ok;
    },
    lock: async () => {
      await call("lock_lock");
      qc.removeQueries({ queryKey: ["journal"] });
      await refresh();
    },
    set: async (args: { current?: string; password?: string; journal: boolean; app: boolean }) => {
      const s = await call<LockStatus>("lock_set", args);
      qc.setQueryData(["lock"], s);
    },
    reset: async (recovery: string) => {
      const s = await call<LockStatus>("lock_reset", { recovery });
      qc.setQueryData(["lock"], s);
    },
  };
}

/** Password field + "forgot" with the recovery key. Used full-window and inside the journal. */
export function UnlockForm({ title, hint }: { title: string; hint: string }) {
  const { unlock, reset } = useLock();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), [forgot]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (forgot) await reset(pw);
      else if (!(await unlock(pw))) {
        setErr("Неверный пароль");
        setPw("");
      }
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="unlock" onSubmit={submit}>
      <span className="unlock-icon">{forgot ? <KeyRound size={20} /> : <LockIcon size={20} />}</span>
      <h2>{forgot ? "Сброс пароля" : title}</h2>
      <p>{forgot ? "Вставь ключ восстановления базы, тот, что сохранял из «Настройки → Данные». Пароль снимется." : hint}</p>
      <input
        ref={input}
        className="field"
        type={forgot ? "text" : "password"}
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder={forgot ? "64 знака: 0–9 и a–f" : "Пароль"}
        autoComplete="off"
        spellCheck={false}
      />
      {err && <span className="unlock-err">{err}</span>}
      <button type="submit" className="btn btn-primary" disabled={!pw || busy}>
        {busy ? "Проверяю…" : forgot ? "Снять пароль" : "Открыть"}
      </button>
      <button
        type="button"
        className="btn btn-quiet unlock-forgot"
        onClick={() => {
          setForgot((f) => !f);
          setPw("");
          setErr(null);
        }}
      >
        {forgot ? "Я вспомнил пароль" : "Забыл пароль"}
      </button>
    </form>
  );
}

/** Everything behind the password: no sidebar, no numbers, nothing rendered underneath. */
export function LockScreen() {
  return (
    // no browser menu here either: nothing to offer behind the lock
    <div className="lockscreen" onContextMenu={(e) => !(e.target as HTMLElement).closest("input") && e.preventDefault()}>
      <div className="lockscreen-brand">
        <Logo />
      </div>
      <UnlockForm title="Tempro заблокирован" hint="Запись идёт как обычно. Чтобы посмотреть данные, введи пароль." />
    </div>
  );
}
