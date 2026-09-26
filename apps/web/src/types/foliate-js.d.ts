// Minimal typings for the parts of foliate-js (https://github.com/johnfactotum/foliate-js)
// the book importer uses. The package ships plain ES modules without types.
declare module 'foliate-js/view.js' {
  export type FoliateTocItem = {
    label?: string
    href?: string
    subitems?: FoliateTocItem[] | null
  }

  export type FoliateSection = {
    linear?: string
    createDocument: () => Promise<Document>
  }

  export type FoliateResolvedHref = {
    index: number
    anchor: (doc: Document) => Element | Range | number | null | undefined
  }

  export type FoliateBook = {
    metadata?: {
      title?: unknown
      author?: unknown
      language?: unknown
    }
    sections: FoliateSection[]
    toc?: FoliateTocItem[]
    resolveHref?: (
      href: string
    ) => FoliateResolvedHref | null | undefined | Promise<FoliateResolvedHref | null | undefined>
    destroy?: () => void
  }

  export class UnsupportedTypeError extends Error {}
  export class NotFoundError extends Error {}
  export const makeBook: (file: File) => Promise<FoliateBook>
}
