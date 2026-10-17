import { WalterAvatar } from "./Avatar"

/** The product mark is Walter's avatar. Kept as `Logo` so existing imports keep working. */
export function Logo({ size = 28, className, title }: { size?: number; className?: string; tile?: boolean; title?: string }) {
  return <WalterAvatar size={size} className={className} alt={title ?? ""} />
}
