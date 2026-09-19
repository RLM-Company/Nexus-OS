# Cosmora Live Companion — product contract v1

## Goal

Cosmora should be able to initiate a conversation after the user explicitly enables the companion mode. The feature is not "send messages on a timer"; it is a governed decision to speak only when there is a useful reason.

## Current release boundary

The current branch implements only the browser-local preference UI and a safe preview. The real proactive scheduler, persistent delivery queue, push transport and authenticated account identity are intentionally not implemented here because they require server-side runtime/auth changes outside the approved non-API release slice.

## Companion rules

1. **Explicit opt-in.** Default is off. Turning it on is a user decision and must be reversible from Settings and from the conversation surface.
2. **One delivery gate.** Every proactive candidate must pass the same ordered gate before delivery:
   - emergency stop / global mute;
   - authenticated owner session;
   - companion enabled;
   - project/chat scope allowed;
   - quiet-hours check;
   - daily and per-type budget;
   - active-conversation suppression;
   - recent non-response backoff;
   - sensitive-context boundary;
   - final content safety/redaction.
3. **No emotional pressure.** Silence is not rejection. The companion must not guilt, threaten, imply dependency, invent urgency or demand an explanation for non-response.
4. **Explain why.** A proactive message should have a compact internal reason such as follow-up, reminder, new context or useful idea. The user-facing message does not need to expose internal scoring.
5. **Prefer low interruption.** If the user is already in Cosmora, show the message in the conversation rather than sending a duplicate push.
6. **Hard caps.** Frequency is bounded by user settings. No adaptive policy may silently increase the user's chosen maximum.
7. **Graceful silence.** After repeated non-response, the system becomes quieter rather than more persistent.
8. **Draft before action.** Proactive suggestions may prepare a draft, but external side effects remain behind existing owner/policy controls.
9. **No hidden sensitive context.** Calendar, location, health, finance, private messages and other sensitive sources require explicit source-level consent before they can become proactive triggers.
10. **Kill switch.** Emergency Stop and account-level mute must silence all proactive producers.

## Proposed event flow

candidate -> policy gate -> content generation -> redaction -> delivery decision -> in-app message -> optional push

A future server contract should return a suppression reason when the gate rejects a candidate. This makes the system auditable without exposing model chain-of-thought.

## Suggested trigger types

- `follow_up`: continue a concrete topic the user previously raised;
- `reminder`: user explicitly asked Cosmora to remember something;
- `new_context`: a connected, consented source changed;
- `idea`: a low-urgency idea that is clearly relevant to the active goal;
- `check_in`: a bounded social check-in enabled by the user.

## Delivery defaults

- companion: off;
- maximum proactive messages: 3/day;
- quiet hours: 22:00–08:00 in the user's configured timezone;
- no duplicate push while the chat is open;
- no follow-up after repeated unanswered proactive messages;
- no external action merely because a proactive message was sent.

## Notifications

Real background delivery needs an authenticated account/device subscription and a server-side push path. Browser permission should be requested only after a user gesture. The UI therefore exposes a permission control but does not create a push subscription in this release.

## Backend blocker

To make the feature truly live, a later backend PR needs a scheduler/queue, authenticated owner identity, persistent companion preferences, a delivery gate, notification transport and a durable audit record. That work should be reviewed separately from the current web-only alpha hardening.

## Design references

- FarVision, "Proactive Assistant Design" — consent, timing, frequency, quiet hours and interruption cost.
- Google Assistant conversation design — explicit opt-in and user-controlled updates.
- Warmth, "How We Design an AI Check-In That Is Worth Sending" — context, timing, new value, cadence, control and graceful silence.
- MDN Push API / Notifications API — permission and server-push mechanics.

This contract is product design guidance, not an authorization to bypass existing Policy Runtime or Emergency Stop controls.
