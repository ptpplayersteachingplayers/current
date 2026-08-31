# Agent module

The AI operations agent, packaged so that the platform runs without it.

PTP's platform — camps, group training, private training, checkout, the two
portals — is the product. The agent is a way of operating it with fewer
people. Those are different things with different risks, so they are
installed separately: if the agent has to be turned off at 9pm on a Tuesday
because it said something wrong, nobody's camp registration stops working.

## What is in the platform, and what is in here

The line is drawn at **the record versus the reasoning**.

The platform keeps identity (`contact_identities`, `find_or_create_contact`),
consent (`may_contact`, `record_consent`), conversations, messages,
`queue_outbound_message`, `record_inbound_message`, and the escalation queue.
A parent sees their thread in the portal and an administrator works the queue
whether or not anything automated exists. Those are business records.

This module adds what the model needs and what chases people:

| Object | What it is |
| --- | --- |
| `agent_context(conversation)` | One read shaped for a model: who this is, what they have, what is open to them. Called before every reply, which is the mechanism behind "it does not rely on memory". |
| `agent_options_for_player(player)` | What may honestly be offered to this child — right age, right level, actually has space. |
| `must_escalate(body)` | The phrases a model never gets to answer. A regex, checked before the message reaches it, so an injury or a chargeback reaches a person whether or not the model recognises it as serious. |
| `scheduled_followups` + `schedule_followup` | The chasing queue, and the deduplication that stops a family being chased twice for the same thing. |
| `queue_followups` / `send_due_followups` | The two hourly jobs. `followup_still_applies` re-checks the reason at send time, so a family who paid ten minutes ago is not asked to pay. |
| `hubspot_sync_batch` | The CRM view of a household, defined in SQL so "lifetime spend" is one line and not a paragraph of TypeScript. |
| `functions/` | Four edge functions: `agent` (the loop), `quo-webhook` (inbound SMS), `email-inbound`, `hubspot-sync`. |

## Install

```bash
./install.sh install ptp        # SQL, then symlink the edge functions
./install.sh uninstall ptp
```

`install.sh install` applies `010_install.sql` and `020_hubspot.sql`, which
call `register_module`, `register_module_job` and `register_module_metric`.
It then symlinks `functions/*` into `supabase/functions/` so
`supabase functions deploy` picks them up; the code itself never leaves this
directory.

Uninstall removes the links, drops the module's functions and its follow-up
queue, and deletes its rows from the registries. It does not touch a message,
a conversation or a consent record — those are the family's history and
belong to the platform. Reinstalling restores the module with that history
intact.

## How it stays a plugin

Two mechanisms, because a folder convention is not a boundary.

**A registry instead of an edit.** The platform's job dispatcher
(`run_scheduled_job`, migration 0020) looks a job up in `core_jobs` or
`module_jobs` and calls it by name. This module declares `queue_followups`
and `send_followups`; it does not appear anywhere in core. The same goes for
the one number the platform reports on the module's behalf — the weekly
summary asks `module_metric('pending_followups')`, which returns zero when
nothing is registered. A missing capability is not a missing table.

**A test that fails if core starts depending on it.** `verify.sh` applies the
core migrations alone and asserts the whole booking path still works, that
`scheduled_followups` does not exist, and that the weekly summary still
returns a number. Only then does it install the module and run the agent
assertions. If somebody adds a core query against a module table, the first
half goes red.

## Environment

The module's edge functions need, beyond the platform's own variables:

| Variable | Used by |
| --- | --- |
| `AGENT_MODEL_KEY`, `AGENT_MODEL` | `agent` |
| `QUO_WEBHOOK_SECRET` | `quo-webhook` |
| `EMAIL_WEBHOOK_SECRET` | `email-inbound` |
| `HUBSPOT_TOKEN` | `hubspot-sync` |

None of these belongs in client code. `agent_context`, `agent_options_for_player`
and `schedule_followup` are revoked from `anon` and `authenticated`: a browser
cannot call them, and neither can a prompt.

## What the agent still cannot do

Unchanged by this repackaging, and worth restating because it is the point:
the agent's tools are the same functions a parent's browser calls, with the
same guards. It cannot exceed a capacity, override an eligibility rule,
refund a payment, or contact somebody who said stop. Those are grants and
constraints in the database, not instructions in a prompt.
