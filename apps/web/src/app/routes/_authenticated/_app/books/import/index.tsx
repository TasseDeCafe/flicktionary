import { createFileRoute } from '@tanstack/react-router'
import { BookImportWizard } from '@/features/books/components/book-import-wizard'

export const Route = createFileRoute('/_authenticated/_app/books/import/')({
  component: BookImportWizard,
  staticData: { hideAppChrome: true },
})
