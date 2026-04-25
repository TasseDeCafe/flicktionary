import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// copied from shadcn's https://ui.shadcn.com/docs/installation/manual
export const cn = (...inputs: ClassValue[]) => {
  return twMerge(clsx(inputs))
}
