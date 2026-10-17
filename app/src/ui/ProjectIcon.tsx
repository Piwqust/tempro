import {
  Anchor, AtSign, BookOpen, Bot, Box, Brush, Briefcase, Building2, Camera, Clapperboard, Clock, Code, Coffee, Compass, Cpu, Database,
  Dices, Dumbbell, Feather, FileText, Flame, Gamepad2, Gem, Globe, GraduationCap, Headphones, HeartPulse, Hexagon, Image, Layers,
  LayoutTemplate, Leaf, Lightbulb, Mail, MessageCircle, Mountain, Music, Newspaper, Palette, PenTool, Plane, Play, Popcorn, Puzzle,
  Radio, Rocket, Send, Settings, Shield, ShoppingBag, Smartphone, Spade, Sparkles, Star, Target, Terminal, Trophy, Tv, User,
  Utensils, Video, Wallet, Zap, type LucideIcon,
} from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { useStore } from "../data/store";
import { iconOf, type IconName } from "../engine/icons";
import type { Project } from "../engine/types";

export const ICON_COMPONENT: Record<IconName, LucideIcon> = {
  palette: Palette, "layout-template": LayoutTemplate, "pen-tool": PenTool, brush: Brush, clapperboard: Clapperboard, image: Image, camera: Camera,
  code: Code, terminal: Terminal, bot: Bot, sparkles: Sparkles, cpu: Cpu, database: Database, globe: Globe, smartphone: Smartphone,
  "message-circle": MessageCircle, send: Send, mail: Mail, "at-sign": AtSign, video: Video, "file-text": FileText, newspaper: Newspaper,
  "book-open": BookOpen, "graduation-cap": GraduationCap, briefcase: Briefcase, "building-2": Building2, wallet: Wallet,
  "shopping-bag": ShoppingBag, clock: Clock, lightbulb: Lightbulb, puzzle: Puzzle, shield: Shield, play: Play, tv: Tv, popcorn: Popcorn,
  radio: Radio, "gamepad-2": Gamepad2, trophy: Trophy, dices: Dices, spade: Spade, music: Music, headphones: Headphones, user: User,
  "heart-pulse": HeartPulse, dumbbell: Dumbbell, utensils: Utensils, plane: Plane, coffee: Coffee, settings: Settings, box: Box,
  layers: Layers, rocket: Rocket, hexagon: Hexagon, target: Target, zap: Zap, star: Star, gem: Gem, leaf: Leaf, flame: Flame,
  compass: Compass, anchor: Anchor, mountain: Mountain, feather: Feather,
};

/** A project's mark: its icon on a tint of its colour. Replaces the bare colour dot. */
export function ProjectIcon({ project, size = 18 }: { project: Project | undefined; size?: number }) {
  const { rules } = useStore();
  const name = useMemo(() => (project ? iconOf(project, rules) : null), [project, rules]);
  if (!project || !name) return <span className="picon picon-none" style={{ width: size, height: size }} />;
  const Icon = ICON_COMPONENT[name];
  return (
    <span className="picon" style={{ width: size, height: size, "--c": project.color } as CSSProperties}>
      <Icon size={Math.round(size * 0.62)} strokeWidth={2} />
    </span>
  );
}
