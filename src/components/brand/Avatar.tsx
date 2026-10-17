import type { WorkerId } from "@/contracts"
import { cn } from "@/lib/utils"
import { svgDataUri, walterSvg, workerSvg } from "./avatars"

type Props = { size?: number; className?: string; alt?: string }

export function WalterAvatar({ size = 40, className, alt = "Walter" }: Props) {
  return (
    <img
      src={svgDataUri("walter", () => walterSvg())}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      className={cn("avatar-frame shrink-0", className)}
    />
  )
}

export function WorkerAvatar({ id, size = 36, className, alt = "" }: Props & { id: WorkerId }) {
  return (
    <img
      src={svgDataUri(`w:${id}`, () => workerSvg(id))}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      className={cn("avatar-frame shrink-0", className)}
    />
  )
}
