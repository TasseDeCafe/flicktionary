// Counts Flicktionary highlights saved during the current browser session.
//
// Backed by `browser.storage.session` so it resets when the browser restarts
// (the "this session" the popup reports). The background increments it after a
// successful `highlights.create`; the popup reads it and subscribes to changes.

const STORAGE_KEY = 'flicktionary.session-highlight-count.v1';

const readCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export const getFlicktionarySessionHighlightCount = async (): Promise<number> => {
    const stored = await browser.storage.session.get(STORAGE_KEY);
    return readCount((stored as Record<string, unknown>)[STORAGE_KEY]);
};

export const incrementFlicktionarySessionHighlightCount = async (): Promise<number> => {
    const next = (await getFlicktionarySessionHighlightCount()) + 1;
    await browser.storage.session.set({ [STORAGE_KEY]: next });
    return next;
};

export const onFlicktionarySessionHighlightCountChange = (listener: (count: number) => void): (() => void) => {
    const wrapped = (
        changes: { [key: string]: Browser.storage.StorageChange },
        areaName: Browser.storage.AreaName
    ) => {
        if (areaName !== 'session') return;
        if (!(STORAGE_KEY in changes)) return;
        listener(readCount(changes[STORAGE_KEY]?.newValue));
    };

    browser.storage.onChanged.addListener(wrapped);
    return () => browser.storage.onChanged.removeListener(wrapped);
};
