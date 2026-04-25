currently we have only one service that is long running: the subscription cache service. but we might have many more in the future, for example if we decide to send some transaction/marketing emails straight from our backend

I created this "long-running" directory so that it's clear where long tasks happen, as forgetting about it can lead to nasty bugs. Note that it's for this reason I made sure the MockAccessCacheService does not use long-running tasks, it shouldn't cause any flaky tests.
