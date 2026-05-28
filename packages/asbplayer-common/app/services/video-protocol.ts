import { Message } from '@asbplayer-fork/common';

export interface VideoProtocol {
    postMessage: (message: Message) => void;
    close: () => void;
    onMessage?: (message: VideoProtocolMessage) => void;
}

export interface VideoProtocolMessage {
    data: Message;
}
