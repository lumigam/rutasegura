import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: Props) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
}

export const Check = (p: Props) => <Icon {...p}><path d="m5 12 4 4L19 6" /></Icon>
export const X = (p: Props) => <Icon {...p}><path d="m6 6 12 12M18 6 6 18" /></Icon>
export const ChevronRight = (p: Props) => <Icon {...p}><path d="m9 18 6-6-6-6" /></Icon>
export const Home = (p: Props) => <Icon {...p}><path d="m3 11 9-8 9 8v10h-6v-6H9v6H3Z" /></Icon>
export const ShieldCheck = (p: Props) => <Icon {...p}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" /><path d="m8 12 3 3 5-6" /></Icon>
export const Trash2 = (p: Props) => <Icon {...p}><path d="M4 7h16m-10 4v6m4-6v6M9 4h6l1 3H8Zm-3 3 1 14h10l1-14" /></Icon>
export const MapPin = (p: Props) => <Icon {...p}><path d="M12 21s7-6.6 7-12a7 7 0 0 0-14 0c0 5.4 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></Icon>
export const BellRing = (p: Props) => <Icon {...p}><path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7Zm4 11h4M4 5 2 7m18-2 2 2" /></Icon>
