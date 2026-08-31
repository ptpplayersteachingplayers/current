-- =============================================================================
-- Module: agent — uninstall
-- =============================================================================
-- Removes the agent and leaves a working platform. Camps, group and private
-- training, checkout, the portals, conversations, consent and the escalation
-- queue all continue: what stops is the automatic answering and chasing.
--
-- Nothing here touches a message, a conversation or a consent record. Those
-- are the family's history and belong to the platform. Running this and then
-- reapplying 010/020 restores the module with that history intact — the only
-- thing lost is the pending follow-up queue, which is a schedule rather than
-- a record.
--
-- Safe to run twice.
-- =============================================================================

-- Stop the scheduled work first, so nothing fires against half-removed
-- functions while the rest of this file runs.
delete from module_jobs    where module = 'agent';
delete from module_metrics where module = 'agent';

drop function if exists queue_followups();
drop function if exists send_due_followups();
drop function if exists followup_still_applies(scheduled_followups);
drop function if exists followup_text(text);
drop function if exists pending_followup_count();
drop function if exists schedule_followup(uuid, text, timestamptz, text, uuid, text, uuid);

drop table if exists scheduled_followups;

drop function if exists agent_context(uuid);
drop function if exists agent_options_for_player(uuid);
drop function if exists must_escalate(text);
drop function if exists hubspot_sync_batch(timestamptz);

delete from platform_modules where name = 'agent';

-- What remains: contacts and their identities, consent, conversations,
-- messages, queue_outbound_message(), record_inbound_message(), escalations
-- and escalate_conversation(). A person can still be messaged and can still
-- reply; there is simply nothing automatic on the other end.
