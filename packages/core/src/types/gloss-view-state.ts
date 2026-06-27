// The gloss popover/sheet view state shared by the web session reader and the
// extension's subtitle overlay — one discriminated union so the two surfaces
// can't drift (the web's old `kind` union and the extension's `status` union
// were the same shape under different names).
//
// `idle` exists for the web sheet (closed/not-yet-opened); the extension never
// constructs it. `ipaDisplay` is the server-picked, dialect-correct IPA string
// from the fastGloss responses — display-ready, no client-side bag picking.
// `ipaLemma` is the lemma the IPA was sourced from when the surface form has no
// pronunciation of its own and we fell back to its lemma's (null otherwise);
// surfaces label the IPA with it so an inflected form isn't implied to be
// pronounced that way.
export type GlossViewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string | null }
  | {
      status: 'ready'
      gloss: string
      pos: string | null
      register: string | null
      ipaDisplay: string | null
      ipaLemma: string | null
    }
