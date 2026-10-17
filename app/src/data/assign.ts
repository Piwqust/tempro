import { appName } from "../engine/context";
import { actions } from "./store";

/** Turn "this thing belongs to project X" into a rule, so the whole history follows. */
export function assign(projectId: string, app: string, context: string) {
  if (context && context !== appName(app)) actions.addRule(projectId, "context", context, "equals");
  else actions.addRule(projectId, "app", app, "equals");
}

export function assignApp(projectId: string, app: string) {
  actions.addRule(projectId, "app", app, "equals");
}
