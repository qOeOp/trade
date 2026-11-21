import { whenSignedOut } from "../lib/transport";
import { atom } from "./atom";

/** Authentication can expire while Paper continues running on the server. */
export const sessionRequired = atom(false);
whenSignedOut(() => sessionRequired.set(true));
