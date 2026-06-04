import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// Compact markdown styling tuned for small chat bubbles: tight vertical rhythm,
// modest list indentation, and inline code that reads against the bubble fill.
// We override elements directly rather than pulling in @tailwindcss/typography,
// whose default `prose` spacing looks loose in this context.
const components: Components = {
  p: ({ children }) => <p className='mb-2 leading-snug last:mb-0'>{children}</p>,
  strong: ({ children }) => <strong className='font-semibold'>{children}</strong>,
  em: ({ children }) => <em className='italic'>{children}</em>,
  ul: ({ children }) => <ul className='mb-2 ml-4 list-disc space-y-1 last:mb-0'>{children}</ul>,
  ol: ({ children }) => <ol className='mb-2 ml-4 list-decimal space-y-1 last:mb-0'>{children}</ol>,
  li: ({ children }) => <li className='leading-snug'>{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target='_blank' rel='noreferrer' className='text-blue-600 underline underline-offset-2'>
      {children}
    </a>
  ),
  code: ({ children }) => <code className='bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]'>{children}</code>,
  pre: ({ children }) => (
    <pre className='bg-muted mb-2 overflow-x-auto rounded p-2 font-mono text-[0.85em] last:mb-0'>{children}</pre>
  ),
  h1: ({ children }) => <h3 className='mb-1 text-sm font-semibold'>{children}</h3>,
  h2: ({ children }) => <h3 className='mb-1 text-sm font-semibold'>{children}</h3>,
  h3: ({ children }) => <h3 className='mb-1 text-sm font-semibold'>{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className='border-muted-foreground/30 text-muted-foreground mb-2 border-l-2 pl-2 last:mb-0'>
      {children}
    </blockquote>
  ),
}

type Props = {
  content: string
  className?: string
}

// Renders assistant chat content as markdown. react-markdown emits real React
// elements (no dangerouslySetInnerHTML), so model output can't inject markup.
export const MarkdownMessage = ({ content, className }: Props) => (
  <div className={cn('break-words', className)}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  </div>
)
