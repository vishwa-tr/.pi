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

## Keyboard agent navigation

With `pi-status-line` loaded, **Alt+N** cycles through subagents and team agents,
then back to the main chat. **Escape** also returns to main. The footer shows the
available count; the focused full-screen view shows the selected agent and its
position. **PageUp/PageDown** scroll its transcript. Live main-agent work continues
in the background. Opening a native dialog returns focus to main.

The focused editor sends text mail only to the selected agent: dormant persistent
agents wake and busy agents queue it. One-shot workers remain subject to their
normal retirement rules; unavailable recipients report a delivery failure. Drafts
are retained while cycling, and failed mail is retained for retry when reopening
the agent. Images are unsupported and are explicitly rejected. Paste text using
your terminal's text-paste command. Commands beginning with `/` or `!` return to
the main editor as a draft; press Enter there to execute them normally.

Packages communicate through plain-data events and remain independently loadable.
Without `pi-status-line`, the existing roster command and viewer remain available.
Session changes, reload, and shutdown release navigation listeners and views.
