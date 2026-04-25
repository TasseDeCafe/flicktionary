import { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@template-app/core/utils/tailwind-utils'
import Link from 'next/link'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  onClick?: () => void
  children: ReactNode
  className?: string
  href?: string
  shouldHaveHoverAndActiveStyles?: boolean
}

export const Button = ({
  onClick = () => {},
  children,
  className,
  href,
  shouldHaveHoverAndActiveStyles = true,
  ...rest
}: ButtonProps) => {
  return (
    <>
      {href ? (
        // sometimes using Link is better because it allows the user to open the link in a new tab, it also automatically adds the new link to the browser history
        <Link
          href={href}
          onClick={onClick}
          className={cn(
            'flex h-12 items-center justify-center rounded-xl px-2 transition-colors duration-200 disabled:cursor-auto disabled:opacity-50 md:px-4',
            className
          )}
        >
          {children}
        </Link>
      ) : (
        <button
          {...rest}
          onClick={onClick}
          className={cn(
            'flex h-12 items-center justify-center rounded-xl px-2 transition-colors duration-200 disabled:cursor-auto disabled:opacity-50 md:px-4',
            {
              'cursor-pointer hover:brightness-95 active:brightness-90 disabled:hover:brightness-100 disabled:active:brightness-100':
                shouldHaveHoverAndActiveStyles,
            },
            {
              'cursor-not-allowed': !shouldHaveHoverAndActiveStyles,
            },
            className
          )}
        >
          {children}
        </button>
      )}
    </>
  )
}
