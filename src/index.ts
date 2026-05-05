import * as core from '@actions/core';
import action from './action';

void (async () => {
    try {
        await action();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        core.setFailed(message);
    }
})();
