import { createContext, useContext } from "react";

export type Screen = "today" | "week" | "month" | "quarter" | "year" | "unsorted" | "projects" | "project" | "journal" | "settings";
export type Nav = { screen: Screen; day: number; projectFilter: string[]; appFilter: string[]; projectId?: string };

export const NavContext = createContext<{ nav: Nav; go: (patch: Partial<Nav>) => void }>(null!);
export const useNav = () => useContext(NavContext);
