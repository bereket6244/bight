# Bight backup format

Bight keeps everything on your device. There is no account and no sync, so the
backup file is the only way to move your progress to another phone — and the
only copy that survives uninstalling the app.

The format is plain JSON so it stays readable, diffable and portable.

## File shape

```json
{
  "format": "bight-backup",
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": 1785484800000,
  "data": {
    "attempts": [],
    "sessions": [],
    "daily": [],
    "achievements": [],
    "personalBests": [],
    "preferences": {}
  }
}
```

| Field | Meaning |
| --- | --- |
| `format` | Always `"bight-backup"`. A file without it is rejected. |
| `schemaVersion` | Integer. The shape of `data`. Current version is **1**. |
| `appVersion` | The Bight build that wrote the file. Informational only. |
| `exportedAt` | Unix milliseconds when the export was taken. |
| `data` | Device-independent user data. Nothing identifying the device is stored. |

### `data.attempts[]`

One record per answered question — enough to reconstruct every statistic in
the app from scratch.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | number | Local row id. Reassigned on import. |
| `sessionId` | string | Groups attempts into their session. |
| `questionId` | string | Stable within a session. |
| `modeId`, `variantId` | string | Which drill produced it. |
| `prompt`, `expected`, `answer` | string | Human-readable, as the user saw them. |
| `correct` | boolean | Graded result. |
| `responseMs` | number | Time from question shown to answer submitted. |
| `source` | string | `touch`, `keypad`, `voice`, `drag` or `timeout`. |
| `orientation` | string | `white` or `black`. |
| `labels`, `layout`, `filters`, `timer` | string | Session settings in force. |
| `focusSquares` | string[] | Every square the question involved. |
| `primarySquare` | string \| null | The square mastery is attributed to. |
| `missed`, `extra` | string[] | For multi-square answers: squares not selected, and squares selected wrongly. |
| `timestamp` | number | Unix milliseconds. |
| `isRetry` | boolean | True when re-asked after an earlier miss. |
| `schemaVersion`, `appVersion` | number, string | Stamped at write time. |

### `data.sessions[]`

Session summaries: `id`, `modeId`, `variantId`, `startedAt`, `endedAt`,
`total`, `correct`, `accuracy`, `averageMs`, `medianMs`, `fastestCorrectMs`,
`bestStreak`, `durationMs`, `endedEarly`, and the full `settings` object so a
session can be repeated exactly.

### `data.daily[]`

One row per day practiced, keyed by local date (`YYYY-MM-DD`): `sessions`,
`questions`, `correct`, `counted`. `counted` is true once the day met the
streak threshold.

Dates are **local** to the device that wrote them. Importing a backup taken in
another timezone keeps the original day boundaries rather than shifting them,
because re-bucketing history would silently rewrite a streak.

### `data.achievements[]`, `data.personalBests[]`, `data.preferences`

Achievements are `{ id, unlockedAt, progress }`. Personal bests are
`{ key, value, achievedAt }`, keyed as `<modeId>:<metric>`. Preferences hold
theme, sound, haptics, daily goal, last mode and saved per-mode settings.

## Import behaviour

Import is deliberately cautious. The order is fixed and tested:

1. **Parse and validate the whole file.** Malformed JSON, a missing `format`,
   a non-array `attempts`, or an attempt without `timestamp`/`correct` all
   fail here.
2. **On any error, stop.** Nothing has been written, so existing data is
   untouched. This is why validation is complete before the first write.
3. **Snapshot current data.**
4. **Migrate** the incoming data up to the current schema.
5. **Merge or replace.**
6. **If the write throws, restore the snapshot** and report that it was rolled
   back.

### Merge vs replace

- **Merge** (default) keeps everything you have and adds only what is new.
  Attempts are identified by `questionId` + `timestamp`, so importing the same
  backup twice adds nothing the second time. Daily rows take the higher count
  of each field; personal bests keep the better value in the correct direction
  (fastest times keep the *lower* number).
- **Replace** discards current data entirely. The pre-import snapshot is still
  taken first.

### Rejected files

A backup written by a **newer** `schemaVersion` than the running build is
rejected rather than guessed at — importing it could silently drop fields the
old build does not understand. The message tells the user to update Bight.

## Migration policy

Every schema version has a migration to the next one, and `migrate()` walks the
chain. A backup from any earlier Bight can therefore be imported by any later
Bight.

| From | To | Change |
| --- | --- | --- |
| 0 | 1 | Renamed `attempt.square` to `primarySquare`; added `focusSquares`, `missed`, `extra`, `isRetry`, `source`, and the `personalBests` collection. |

Schema 0 was the pre-release layout and is retained as a migration test
fixture, so the chain is exercised on every test run rather than assumed.

### Adding a schema version

1. Bump `SCHEMA_VERSION` in `src/core/storage/types.ts`.
2. Add a `Migration` entry in `src/core/backup/format.ts` with `from`, `to`,
   a one-line `describe`, and a pure `apply`.
3. Add a fixture at the old shape to `src/core/backup/backup.test.ts`.

The test suite asserts the chain is continuous, so a missing migration fails
the build rather than surfacing as a corrupt import later.

## Where the file goes

Export uses the browser download path, which Capacitor routes through
Android's Storage Access Framework. Import uses a standard file picker. Bight
requests **no** broad storage permission — the picker grants access to the one
file you choose.

The suggested filename is `bight-backup-YYYYMMDDHHmm.json`.
