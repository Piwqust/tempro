import { actions, useStore } from "../data/store";
import { Menu } from "./Menu";
import { ProjectIcon } from "./ProjectIcon";

type Props = {
  current: string | null;
  onPick: (projectId: string) => void;
  footer?: React.ReactNode;
};

export function ProjectPicker({ current, onPick, footer }: Props) {
  const { projects } = useStore();
  return (
    <Menu
      placeholder="Проект…"
      items={projects
        .filter((p) => !p.archived)
        .map((p) => ({ id: p.id, label: p.name, icon: <ProjectIcon project={p} size={16} />, checked: p.id === current }))}
      onPick={onPick}
      onCreate={(name) => onPick(actions.addProject(name).id)}
      createLabel={(q) => `Новый проект «${q}»`}
      footer={footer}
    />
  );
}
