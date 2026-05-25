-- The localized seed question for a highlight's per-card chat.
--
-- A saved note/preset is answered in the card chat. The user-visible question is
-- composed on the FRONTEND so the preset phrasing is localized via the existing
-- i18n catalog (and the freeform note rides along verbatim) — the backend never
-- enumerates languages. The async seed_card_chat worker reads this column as the
-- chat turn's content. Nullable: only set when a note/preset is saved; a later
-- save overwrites it, so a coalesced pending job picks up the latest text.
ALTER TABLE public.highlights
  ADD COLUMN chat_seed_prompt TEXT NULL;
