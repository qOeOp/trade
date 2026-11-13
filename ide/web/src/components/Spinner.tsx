import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";

/** A turning ring for work in flight; under reduced motion the `still` icon stands in its place. */
export const Spinner = ({ size = 12, still = "history", className = "" }: { size?: 12 | 16; still?: IconName; className?: string }) =>
  <><Icon name="loading" size={size} className={`${className} motion-safe:animate-spin motion-reduce:hidden`} />
    <Icon name={still} size={size} className={`${className} motion-safe:hidden`} /></>;
