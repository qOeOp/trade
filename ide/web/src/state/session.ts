import { atom } from "./atom";

/** Authentication can expire while Paper continues running on the server. */
export const sessionRequired = atom(false);
