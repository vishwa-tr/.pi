# Pi account login navigation

## Summary

In the verified managed Pi 1.0.4 UI, use `/login`, select **Sign in with an
account**, then filter the provider picker with `OpenAI`. The list includes
**OpenAI** and **OpenAI Codex (legacy)**. Inspect the current UI because labels
and available providers may change with the installed runtime.

## Details

1. Verify the main editor is empty, type `/login`, and press Return.
2. Select **Sign in with an account**. The authentication-method menu also offers
   API-key and Radius paths; these are separate flows.
3. In the provider picker's search field, type `OpenAI` to narrow the results.
4. Select **OpenAI Codex (legacy)** using the visible selection, rather than a
   fixed number of Down presses from the full list. In the verified filtered
   list it was the second of two entries.
5. Capture the selected entry before continuing. Highlighting a provider does
   not start authentication; Return advances into that provider's flow.

A `stored` indicator means credentials were saved, not that they remain valid.
An expired refresh token can coexist with this label. If a submitted message
fails with HTTP 401 and `refresh_token_expired`, use the normal sign-in flow;
do not copy credentials into documentation, chat, or diagnostic logs.

For desktop automation, use the shared
[Linux desktop session guide](../../../.agents/docs/guides/linux-desktop-sessions.md).
On the verified GNOME Wayland VM, native Mutter key input worked with an XWayland
Ptyxis terminal. Wake, focus, type, and capture helpers are documented there.
Keep authorization URLs, one-time codes, and authentication artifacts out of
reusable resources.

Verified 2026-10-07 against the running Pi 1.0.4 UI: `/login`, account-provider
selection, filtering, and highlighting the legacy entry were exercised.
The legacy entry then offered **Browser login (default)** and **Device code login
(headless)**. Selecting the device-code method displayed a verification URL and
a short one-time code, then waited for browser authentication. When the user
requests the URL and code, return the live values in the private chat and leave
the terminal waiting; do not save those transient values in this guide. Successful
authentication must be checked in the application after the user finishes browser
sign-in. This flow was subsequently verified: the terminal reported successful
legacy-provider login and returned to the main editor. Retry a harmless prompt
to check provider requests separately from credential storage. The follow-up
no-tool test also succeeded: the provider returned the requested short reply.
