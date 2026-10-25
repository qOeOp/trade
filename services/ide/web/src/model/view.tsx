import { createContext, useContext, type ReactNode } from "react";
import type { View, Widget } from "./types";

// The immutable view model for the whole page, so no widget or shell part takes it as a prop.
const ViewContext = createContext<View | null>(null);

export function ViewProvider({ view, children }: { view: View; children: ReactNode }) {
  return <ViewContext.Provider value={view}>{children}</ViewContext.Provider>;
}

export function useView(): View {
  const view = useContext(ViewContext);
  if (!view) throw new Error("useView outside ViewProvider");
  return view;
}

/** The first widget of a type, if the view has one. */
export function useWidget<T extends Widget>(type: string): T | undefined {
  return useView().widgets.find((w) => w.type === type) as T | undefined;
}
