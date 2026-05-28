import { onMessage } from '@asbplayer-fork/common/audio-clip/mp3-encoder-worker';

export default defineUnlistedScript(() => {
    onMessage();
});
