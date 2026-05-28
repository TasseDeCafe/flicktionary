import { onMessage } from '@asbplayer-fork/common/subtitle-reader/pgs-parser-worker';

export default defineUnlistedScript(() => {
    onMessage();
});
