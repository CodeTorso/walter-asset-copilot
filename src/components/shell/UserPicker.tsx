import { ChevronsUpDown } from "lucide-react"
import { useChatStore } from "@/lib/stores/chat"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { initials, roleLabel, usePickerUsers, useUsers } from "./users"

function Initials({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-[6px] bg-[#f0f0f0] text-[11px] font-bold text-ink"
    >
      {initials(name)}
    </span>
  )
}

export function UserPicker({ compact, className }: { compact?: boolean; className?: string }) {
  const userId = useChatStore((s) => s.userId)
  const setUser = useChatStore((s) => s.setUser)
  const users = useUsers()
  const pickable = usePickerUsers()
  const me = users.find((u) => u.userId === userId) ?? users[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Signed in as ${me.name}. Switch user`}
        className={cn("btn-key justify-start gap-2.5 text-left", compact ? "h-9 px-1.5" : "h-auto w-full p-2", className)}
      >
        <Initials name={me.name} size={compact ? 26 : 32} />
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold">{me.name}</span>
            <span className="block truncate text-[12px] text-muted-foreground">{roleLabel(me.role)}</span>
          </span>
        )}
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="max-h-[60vh] w-64 rounded-[8px] shadow-(--shadow-float) ring-0">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Switch user. Each person has their own chat with Walter.</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={userId} onValueChange={setUser}>
          {pickable.map((u) => (
            <DropdownMenuRadioItem key={u.userId} value={u.userId} className="gap-2.5 py-1.5">
              <Initials name={u.name} size={24} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{u.name}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">{roleLabel(u.role)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
