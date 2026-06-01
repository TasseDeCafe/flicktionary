// Word segmentation now lives in the shared core package so the browser
// extension can tokenize subtitles identically. Re-exported here so existing
// web consumers (`segment-row.tsx`, `annotated-text.tsx`) keep their import.
export * from '@flicktionary/core/dom/word-segmenter'
