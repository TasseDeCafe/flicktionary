// Deterministic per-lesson chunking (validated in the extractor prototype: no
// model-side segmentation needed). Google-Docs markdown exports carry one
// table per lesson under a `### **DD/MM/YYYY**` heading; xlsx normalizations
// emit the same heading per sheet. Tolerates heading level, optional bold,
// and `.` or `/` date separators. Input without any date heading is one
// section (the extractor still reports lesson_date: null).
const DATE_HEADING = /^#{1,6}\s+\*{0,2}\d{1,2}[./]\d{1,2}[./]\d{4}\*{0,2}\s*$/

export const splitLessonSections = (rawText: string): string[] => {
  const lines = rawText.split('\n')
  const sections: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (DATE_HEADING.test(line.trim()) && current.some((l) => l.trim().length > 0)) {
      sections.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.some((l) => l.trim().length > 0)) sections.push(current.join('\n'))
  return sections.length > 0 ? sections : [rawText]
}
