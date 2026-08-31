# The AI agent

It answers parents by SMS and email, and books them in. Most of it lives in the
database rather than in a prompt, for one reason: a prompt is a request, and a
grant is a fact.

## Where it lives

It is a module, not part of the platform: `supabase/modules/agent`, installed
and removed on its own with `./install.sh install` and `./install.sh uninstall`.
Camps, training, checkout and the two portals run without it.

The line is drawn at the record versus the reasoning. The platform keeps
identity, consent, conversations, messages and the escalation queue — a parent
reads their own thread and an administrator works the queue whether or not
anything automated exists. The module adds the model's view of a family
(`agent_context`), what may honestly be offered (`agent_options_for_player`),
the phrases it never gets to answer (`must_escalate`), the follow-up queue and
the HubSpot view. Uninstalling drops those and leaves every message, thread and
consent record where it was.

## What it can do

Ten tools, listed in `modules/agent/functions/agent-tools.ts`. Each one is a single call to
a database function that enforces its own rule:

| Tool | Underneath |
|---|---|
| `get_context` | `agent_context()` — the family, their children, credits, upcoming sessions |
| `get_options` | `agent_options_for_player()` — only groups, camps and slots that player is eligible for |
| `add_player` | an insert into `players`, scoped to the conversation's household |
| `hold_group_place` | `create_booking_hold()` — the same fifteen minutes a browser gets |
| `create_payment_link` | `begin_checkout()` / `begin_camp_registration()` — priced server-side |
| `join_waitlist` | `join_waitlist()` / `join_camp_waitlist()` |
| `record_note` | `interaction_notes` |
| `schedule_followup` | `schedule_followup()`, deduplicated on (household, reason, subject) |
| `escalate` | `escalate_conversation()` — hands the thread to a person and goes quiet |
| `set_state` | the conversation state machine |

## What it cannot do

Not by instruction. There is no function to call.

- Mark a booking paid. Only the Stripe webhook settles a payment.
- Refund, or change a price, or adjust a credit balance.
- Override eligibility, or a capacity, or a policy.
- Confirm anything before Stripe and the database agree it happened.
- Write to the audit log, run a job, or commit a trainer to a block.

Every one of those is `revoke all ... from public, anon, authenticated` in
0017, 0019 and the module’s own install, and the agent reaches the database through a service key held in
an edge function. `verify.sh` asserts each refusal, as an anonymous caller and
as a signed-in parent.

## Escalation does not depend on the model

`must_escalate()` is a pattern match run in SQL **before** the message reaches
the model. An injury, a chargeback, a lawyer or a waiver goes to a person
whether or not the model recognises it as serious — an escalation that depends
on the thing being escalated about is not an escalation.

The model may also escalate on its own judgement, and the system prompt tells
it that escalating is never the wrong call. Both routes end the same way: the
conversation becomes `human_owned`, and `queue_outbound_message()` then refuses
anything automated on that thread.

## Consent

`may_contact()` answers one question — may we send to this person, on this
channel, at this moment — and every send goes through it. Three separate
conditions: they have not unsubscribed, they consented on this channel, and it
is not the middle of the night in *their* timezone.

STOP is handled in `record_inbound_message()`, in SQL, before anything else
looks at the message. It works whether or not the agent is running, whether or
not the model is available, and whether or not it understood the rest of the
text.

Reminders about a session a family has already booked are transactional: they
respect consent and unsubscribe, and ignore quiet hours. The distinction is
between a message they asked for by booking and one we decided to send.

## What is not verified

The agent loop has never run. There is no Deno runtime here and no Anthropic
key, so `modules/agent/functions/agent/index.ts`, the two inbound webhooks and the HubSpot
sync are design plus review — the model call, the tool loop and the retry
behaviour are all unexecuted.

What *is* executed is everything they call: the identity matching, the consent
rules, the escalation triggers, the tool contract's refusals, the follow-up
scheduler and the CRM view. 187 assertions against PostgreSQL 16.
