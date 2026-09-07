# Daily simulation and radius balance

The server checks once an hour and completes one growth run per Toronto calendar day. Each day adds two labelled Firebase test accounts. Every tester, including the eight original testers, publishes two posts. The first day therefore has ten testers and twenty posts; the second has twelve testers and twenty-four posts. Deterministic account/post IDs and a daily completion record prevent completed runs from duplicating work.

Posts rotate across twenty-four cities, with approximate locations and approved official media. Simulation captions and account profiles identify the traffic as test activity. The server creates these fixtures directly; the browser runner remains a separate tool for testing the upload UI.

Each tester engages with one available post by the consenting owner and up to three posts by other accounts. Views, reactions and comments use the production engagement transaction, including blocks, grant limits, account totals and radius history. About one third of tester/post pairs on simulation posts dislike instead of like; owner and other real posts receive positive test engagement. Comment text is saved and displayed in Feed TV.

## Why radius goes down

- Earned radius loses 5% per day, applied by the hourly server job using elapsed time. An untouched 10 km of earned radius becomes 9.5 km after a day.
- A dislike removes up to 1 km of earned radius, once per account/post pair. It cannot take earned radius below zero.
- The discovery seed is a floor and does not decay. A post with a 5 km seed and 10 km earned reach goes from 15 km to 14.5 km after a day without new engagement.
- Purchased boosts retain their own expiry rules. Repeated views earn progressively less, and repeated likes/comments cannot repeatedly grant the same radius.

These are downward forces, not a promise that every post falls each day: a popular post can earn more than it loses. The history records actual dislike and decay reductions. Browser telemetry no longer fabricates increasing map-post reach.

## Operations

Cloud Scheduler job: `firebase-schedule-syntheticDailySimulation-us-central1`, project `poplur2025`.

The job requires both `testControl/syntheticDailySimulation.enabled` and the existing simulation master switch `testControl/syntheticBrowserRunner.enabled`. Daily results are recorded in `testDailySimulationRuns/YYYY-MM-DD`; the growing roster is in `testDailySimulationActors`. `ownerUid` selects the consenting owner's posts. Posting quotas are constants in `syntheticDailyPolicy.ts`.

The old Mac LaunchAgent `com.poplur.synthetic-live-scheduler` is disabled because its two-hour quota resets conflict with persistent daily quotas. The cloud schedule runs independently of the Mac.

Feed TV comments default on across web and native shells, and map radio starts by default on entering Map. Explicit choices to turn either off remain saved.

## Validation

Backend policy checks cover daily IDs, timezone boundaries, city rotation and reaction balance. The Auth/Firestore emulator integration covers twenty posts on day one, twenty-four on day two, retry deduplication and persisted comments. Frontend checks cover comment/radio defaults and radius-history summaries.
