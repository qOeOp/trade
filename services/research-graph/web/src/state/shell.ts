// The shell's own state: which island the user last worked in, and whether the palette is open.
// (Step 2 adds the tool windows here.)
import { atom } from "./atom";

export const activeIsland = atom<string>("editor");
export const paletteOpen = atom<boolean>(false);
