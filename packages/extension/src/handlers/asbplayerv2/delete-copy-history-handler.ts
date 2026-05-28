import type { Command, DeleteCopyHistoryMessage, Message } from '@asbplayer-fork/common';
import { IndexedDBCopyHistoryRepository } from '@asbplayer-fork/common/copy-history';
import { SettingsProvider } from '@asbplayer-fork/common/settings';

export default class DeleteCopyHistoryHandler {
    private readonly _settings: SettingsProvider;
    constructor(settings: SettingsProvider) {
        this._settings = settings;
    }

    get sender() {
        return 'asbplayerv2';
    }

    get command() {
        return 'delete-copy-history';
    }

    handle(command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (r?: any) => void) {
        const message = command.message as DeleteCopyHistoryMessage;
        this._settings
            .getSingle('miningHistoryStorageLimit')
            .then((limit) => new IndexedDBCopyHistoryRepository(limit))
            .then((copyHistoryRepository) => {
                return Promise.all(message.ids.map((id) => copyHistoryRepository.delete(id))).then(() => {
                    sendResponse({});
                });
            });

        return true;
    }
}
