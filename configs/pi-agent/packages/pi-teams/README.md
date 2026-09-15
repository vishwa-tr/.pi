# pi-teams

Persistent team agents with optional peer messaging, disk-backed mail, anchored
`team_await`, and a `/teams` roster and transcript viewer.

## Delivery and completion

Tool results use compact JSON. Successfully delivered final reports, `ask`, and
`send_message { expectReply: true }` terminate the automatic follow-up only when
all finalized results in the tool batch terminate. Progress reports, ordinary
messages, answers, and delivery failures never terminate. Questions resume with
their correlated answers; one-shot retirement is armed only after successful
final-report delivery.

Idle completions coalesce for 300 ms from the first event without extending the
deadline for later arrivals. Input, a new run, or shutdown cancels the timer.
Mail is consumed only when its envelope IDs are found in the persisted host
transcript—not when Pi's void `sendMessage` returns. Failed or interrupted
injections stay pending for the next lifecycle/mail event or session resume.
An inference failure after persistence does not cause duplicate injection.

## Verification

Run the strict typecheck and all scripted-provider harnesses:

```bash
./test/e2e/run.sh
```

Reload or restart Pi after package changes.
