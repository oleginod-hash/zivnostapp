import {
  ArrowDown, ArrowRight, ArrowUp, Bell, Building2, Calculator, Calendar, CalendarClock,
  ChartNoAxesColumn, Check, ClipboardList, Clock, Coins, Download, Eye, EyeOff, FileDown, FilePen,
  FileSpreadsheet, FileText, FolderOpen, Info, LayoutDashboard, Lock, Mail, MessageSquare,
  Moon, Paperclip, Pencil, PiggyBank, Plus, Printer, ReceiptText, RotateCcw, Scale, ScanLine,
  Search, Send, SlidersHorizontal, Sparkles, Sun, Trash2, TriangleAlert, Wallet, X,
  type LucideIcon,
} from 'lucide-react'

/**
 * Ikony appky – sada Lucide, rovnaká ako v návrhu dizajnu.
 *
 * Stránky nepoužívajú Lucide priamo, ale cez tento zoznam kľúčov. Keby sa
 * raz menila sada ikon, stačí to spraviť tu a appka ostane jednotná.
 * Ikony dedia farbu textu, takže sa samy prispôsobia téme aj stavu tlačidla.
 */
const IKONY = {
  // Navigácia
  logo: ChartNoAxesColumn,
  prehlad: LayoutDashboard,
  faktury: FileText,
  financie: PiggyBank,
  vydavky: ReceiptText,
  turnusy: CalendarClock,
  upomienky: Bell,
  objednavky: ClipboardList,
  zmluvy: FilePen,
  firmy: Building2,
  pomocnik: MessageSquare,
  uctovnik: Calculator,
  pravnik: Scale,
  podklad: Download,
  kos: Trash2,
  nastavenia: SlidersHorizontal,
  zamok: Lock,

  // Stavy
  zaplatena: Check,
  pozor: TriangleAlert,
  hodiny: Clock,
  zaloha: Coins,
  kalendar: Calendar,
  info: Info,
  ai: Sparkles,

  // Akcie
  plus: Plus,
  sken: ScanLine,
  upravit: Pencil,
  zmazat: Trash2,
  zavriet: X,
  priloha: Paperclip,
  odoslat: Send,
  mail: Mail,
  hladat: Search,
  vratit: RotateCcw,
  tlacit: Printer,
  excel: FileSpreadsheet,
  subor: FolderOpen,
  pdf: FileDown,
  penazenka: Wallet,

  // Téma a súkromie
  slnko: Sun,
  mesiac: Moon,
  oko: Eye,
  okoSkryte: EyeOff,

  // Smery
  hore: ArrowUp,
  dole: ArrowDown,
  vpravo: ArrowRight,
} satisfies Record<string, LucideIcon>

export type KlucIkony = keyof typeof IKONY

type Props = {
  nazov: KlucIkony
  /** Veľkosť v pixeloch (predvolene 17, ako v bočnom paneli návrhu). */
  velkost?: number
  /** Hrúbka ťahu – malé akčné ikony znesú hrubšiu čiaru. */
  hrubka?: number
  className?: string
}

export function Ikona({ nazov, velkost = 17, hrubka = 1.6, className }: Props) {
  const Komponent = IKONY[nazov]
  return <Komponent size={velkost} strokeWidth={hrubka} className={className} aria-hidden="true" />
}
