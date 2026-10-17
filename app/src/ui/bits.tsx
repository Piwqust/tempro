import type { CSSProperties } from "react";
import { useAppIconUrl } from "../data/icons";
import { appName } from "../engine/context";
import type { Project } from "../engine/types";
import { t } from "../lib/i18n";
import { durParts } from "../lib/time";
import { ProjectIcon } from "./ProjectIcon";

const APP_TINTS = ["#2a9d8f", "#c4553b", "#7a8b2a", "#7a5cc2", "#3b7fc4", "#c2873b", "#b5487a", "#4a8a5c"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const appTint = (app: string) => APP_TINTS[hash(app) % APP_TINTS.length];

/** The program's real icon when Tempro knows its exe; a quiet initials tile otherwise. */
export function AppIcon({ app, size = 18 }: { app: string; size?: number }) {
  const url = useAppIconUrl(app);
  if (url) return <img className="app-img" src={url} width={size} height={size} alt="" aria-hidden draggable={false} />;
  const name = appName(app);
  const words = name.split(/[\s.-]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
  return (
    <span
      className="app-icon"
      style={{ "--c": appTint(app), width: size, height: size, fontSize: size * 0.46 } as CSSProperties}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function Dot({ color, size = 8 }: { color?: string; size?: number }) {
  return <span className="dot" style={{ background: color ?? "var(--ink-4)", width: size, height: size }} />;
}

export function ProjectTag({ project }: { project: Project | undefined }) {
  if (!project) return <span className="tag tag-none">{t("Без проекта")}</span>;
  return (
    <span className="tag" style={{ "--c": project.color } as CSSProperties}>
      <ProjectIcon project={project} size={14} />
      {project.name}
    </span>
  );
}

/** "3,5" big + "ч" small. */
export function BigNum({ ms, className }: { ms: number; className?: string }) {
  const [n, u] = durParts(ms);
  return (
    <span className={"bignum " + (className ?? "")}>
      {n}
      {u && <span className="bignum-unit">{u}</span>}
    </span>
  );
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="kbd">{children}</kbd>;
}
