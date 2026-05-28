import type { Command, Message, RequestCopyHistoryMessage, RequestCopyHistoryResponse } from '@asbplayer-fork/common';
import { IndexedDBCopyHistoryRepository } from '@asbplayer-fork/common/copy-history';

export default class RequestCopyHistoryHandler {
    get sender() {
        return 'asbplayerv2';
    }

    get command() {
        return 'request-copy-history';
    }

    handle(command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (r?: any) => void) {
        const message = command.message as RequestCopyHistoryMessage;
        new IndexedDBCopyHistoryRepository(message.count).fetch(message.count).then((copyHistoryItems) => {
            const response: RequestCopyHistoryResponse = {
                copyHistoryItems,
            };
            sendResponse(response);
        });
        return true;
    }
}
