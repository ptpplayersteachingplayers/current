// =============================================================================
// The agent's tools
// =============================================================================
// A closed list. Each entry names a database function, and the database
// function enforces the rule — so a prompt that talks the model into calling
// something is still bounded by what that function will do.
//
// What is deliberately absent is as important as what is here. There is no
// tool to mark a booking paid, to refund, to change a price, to override
// eligibility, to adjust credits, or to confirm anything Stripe has not
// confirmed. Those are not withheld by instruction; there is no function to
// call.
// =============================================================================

import { asService } from "../../../functions/_shared/db.ts";

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export const TOOLS = [
  {
    name: "get_context",
    description:
      "Read who this conversation is with, their children, their credits, their upcoming sessions and camps. Call this before recommending or booking anything — never answer from memory of an earlier turn.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_options",
    description:
      "List the training groups, camps and private slots a specific player is eligible for, with how full each is. Only offer things this returns.",
    parameters: {
      type: "object",
      properties: { player_id: { type: "string" } },
      required: ["player_id"],
    },
  },
  {
    name: "add_player",
    description:
      "Add a child to this family. Use when a parent tells you about a child we do not have. Ask for a birthday rather than an age: an age goes stale and the eligibility rules are computed from the date.",
    parameters: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        birth_date: { type: "string", description: "YYYY-MM-DD" },
        skill_level: { type: "integer", description: "1 to 5, 2 if unsure" },
        club_team: { type: "string" },
      },
      required: ["first_name", "birth_date"],
    },
  },
  {
    name: "hold_group_place",
    description:
      "Hold a place in a training group for fifteen minutes so the parent can pay. Tell them the hold is running.",
    parameters: {
      type: "object",
      properties: { group_id: { type: "string" }, player_id: { type: "string" } },
      required: ["group_id", "player_id"],
    },
  },
  {
    name: "create_payment_link",
    description:
      "Create a Stripe payment link for a held place, a camp or a private slot. Send the link. Do not tell the parent they are booked — they are booked when the payment settles and you are told so.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["group_package", "group_dropin", "private", "camp"] },
        player_id: { type: "string" },
        target_id: { type: "string" },
        day_option: { type: "string", enum: ["full_day", "half_day"] },
      },
      required: ["kind", "player_id", "target_id"],
    },
  },
  {
    name: "join_waitlist",
    description: "Put a player on the waitlist for a full group or camp.",
    parameters: {
      type: "object",
      properties: {
        player_id: { type: "string" },
        group_id: { type: "string" },
        camp_id: { type: "string" },
      },
      required: ["player_id"],
    },
  },
  {
    name: "record_note",
    description:
      "Save what you learned about this family — preferences, availability, what they are deciding between. Write it for the person who picks this up next, not for yourself.",
    parameters: {
      type: "object",
      properties: { summary: { type: "string" }, detail: { type: "object" } },
      required: ["summary"],
    },
  },
  {
    name: "schedule_followup",
    description:
      "Come back to this family later — after a payment link goes unpaid, or when a group they wanted might fill.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
        hours_from_now: { type: "number" },
      },
      required: ["reason", "hours_from_now"],
    },
  },
  {
    name: "escalate",
    description:
      "Hand this conversation to a person. Use it for anything about an injury, a refund or a charge, a waiver, a complaint, a conflict in our records, or anything you are not confident about. Escalating is never the wrong call.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", enum: ["safety", "refund", "legal", "unhappy", "records", "unclear", "exception"] },
        summary: { type: "string" },
        recommended_action: { type: "string" },
        severity: { type: "string", enum: ["low", "normal", "urgent"] },
      },
      required: ["reason", "summary"],
    },
  },
  {
    name: "set_state",
    description: "Move the conversation to the state that describes where it now is.",
    parameters: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: ["new_inquiry", "collecting_player_info", "collecting_availability",
                 "recommending", "awaiting_selection", "hold_created", "payment_pending",
                 "booked", "waitlisted", "follow_up_required", "escalated", "closed"],
        },
      },
      required: ["state"],
    },
  },
] as const;

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: { conversationId: string; householdId: string | null },
): Promise<ToolResult> {
  const db = asService();

  // Each case is one RPC. There is no branch here that composes several, and
  // none that writes a table directly — so the list of things the agent can do
  // is exactly the list of functions below.
  try {
    switch (name) {
      case "get_context": {
        const { data, error } = await db.rpc("agent_context", { p_conversation_id: context.conversationId });
        if (error) throw error;
        return { ok: true, data };
      }

      case "get_options": {
        const { data, error } = await db.rpc("agent_options_for_player", { p_player_id: args.player_id });
        if (error) throw error;
        return { ok: true, data };
      }

      case "add_player": {
        if (!context.householdId) return { ok: false, error: "No household on this conversation yet" };

        const { data, error } = await db
          .from("players")
          .insert({
            household_id: context.householdId,
            first_name: args.first_name,
            last_name: args.last_name ?? "",
            birth_date: args.birth_date,
            skill_level: args.skill_level ?? 2,
            club_team: args.club_team ?? "",
          })
          .select("id, first_name, birth_date")
          .single();

        if (error) throw error;
        return { ok: true, data };
      }

      case "hold_group_place": {
        const { data: sessions, error: sessionError } = await db
          .from("sessions")
          .select("id")
          .eq("group_id", args.group_id)
          .eq("status", "scheduled")
          .gt("starts_at", new Date().toISOString())
          .order("starts_at")
          .limit(1);

        if (sessionError) throw sessionError;
        if (!sessions?.length) return { ok: false, error: "That group has no upcoming sessions" };

        const { data, error } = await db.rpc("create_booking_hold", {
          p_session_id: sessions[0].id,
          p_player_id: args.player_id,
          p_use_credit: false,
        });

        if (error) throw error;
        return { ok: true, data };
      }

      case "create_payment_link": {
        // Priced and held by the same functions the website uses. The agent
        // supplies what, never how much.
        const idempotencyKey = `agent:${context.conversationId}:${args.kind}:${args.target_id}`;

        const rpc = args.kind === "camp"
          ? db.rpc("begin_camp_registration", {
              p_camp_id: args.target_id,
              p_player_id: args.player_id,
              p_day_option: args.day_option ?? "full_day",
              p_idempotency_key: idempotencyKey,
              p_addon_ids: [],
              // The paperwork is not something to collect over SMS. The link
              // takes them to the form, which is also where the agreements are
              // recorded with a timestamp.
              p_details: {},
            })
          : db.rpc("begin_checkout", {
              p_kind: args.kind,
              p_player_id: args.player_id,
              p_target_id: args.target_id,
              p_idempotency_key: idempotencyKey,
            });

        const { data, error } = await rpc.single();

        if (error) {
          // A camp registration refused for want of the forms is not a failure
          // to report as one: send them to the page that collects them.
          if (String(error.message ?? "").startsWith("Still needed")) {
            return {
              ok: true,
              data: {
                needs_form: true,
                url: `${Deno.env.get("PTP_SITE_URL")}/camp/?c=${args.target_id}#register`,
              },
            };
          }
          throw error;
        }

        return {
          ok: true,
          data: {
            amount_cents: data.amount_cents,
            expires_at: data.expires_at,
            url: `${Deno.env.get("PTP_SITE_URL")}/pay/?i=${data.id}`,
          },
        };
      }

      case "join_waitlist": {
        const { data, error } = args.camp_id
          ? await db.rpc("join_camp_waitlist", { p_camp_id: args.camp_id, p_player_id: args.player_id }).single()
          : await db.rpc("join_waitlist", { p_group_id: args.group_id, p_player_id: args.player_id }).single();

        if (error) throw error;
        return { ok: true, data };
      }

      case "record_note": {
        const { error } = await db.from("interaction_notes").insert({
          conversation_id: context.conversationId,
          household_id: context.householdId,
          summary: args.summary,
          detail: args.detail ?? {},
          written_by: "ai",
        });

        if (error) throw error;
        return { ok: true };
      }

      case "schedule_followup": {
        if (!context.householdId) return { ok: false, error: "No household on this conversation yet" };

        const due = new Date(Date.now() + Number(args.hours_from_now ?? 24) * 3_600_000);

        const { data, error } = await db.rpc("schedule_followup", {
          p_household_id: context.householdId,
          p_reason: args.reason,
          p_due_at: due.toISOString(),
          p_conversation_id: context.conversationId,
        });

        if (error) throw error;
        return { ok: true, data };
      }

      case "escalate": {
        const { data, error } = await db.rpc("escalate_conversation", {
          p_conversation_id: context.conversationId,
          p_reason: args.reason,
          p_summary: args.summary,
          p_severity: args.severity ?? "normal",
          p_recommended_action: args.recommended_action ?? "",
          p_detail: {},
        });

        if (error) throw error;
        return { ok: true, data };
      }

      case "set_state": {
        const { error } = await db
          .from("conversations")
          .update({ agent_state: args.state })
          .eq("id", context.conversationId);

        if (error) throw error;
        return { ok: true };
      }

      default:
        // A tool name the model invented. Reported back to it rather than
        // thrown, so it can correct itself in the next turn.
        return { ok: false, error: `There is no tool called ${name}` };
    }
  } catch (error) {
    return { ok: false, error: String((error as { message?: string })?.message ?? error) };
  }
}

export const SYSTEM_PROMPT = `You answer messages for PTP — Players Teaching Players, a soccer training
company in Pennsylvania and New Jersey. You are talking to a parent, usually
by text, usually while they are doing something else.

How to write:
- Short. Two or three sentences. This is a text message, not a letter.
- Plain. No exclamation marks, no "Great question!", no emoji.
- Say the useful thing first. "Tuesday and Thursday at 5:30, three places left"
  before "thanks for getting in touch".
- Never invent a time, a price, a place or a coach. If you did not read it from
  a tool this turn, you do not know it.

What PTP runs:
- Summer camps: five days, ages 6 to 14, full and half day.
- Group training: eight weeks, twice a week, sixteen sessions, six players at
  most, matched by age and level. A group runs once four families have paid.
- Private training: one player, one coach, mostly weekends.

How to work:
1. Call get_context first, every time. What you remember from earlier is not
   evidence about what is available now.
2. If you do not know which child, ask. If we do not have the child, add_player
   with their birthday — not their age.
3. Call get_options before naming anything. Offer only what it returns.
4. To book: hold_group_place, then create_payment_link, then send the link and
   say the place is held for fifteen minutes.
5. Never say a family is booked. They are booked when the payment settles and
   you are told so. Say "once that goes through, you are in".
6. record_note before you finish, and set_state.

When to stop and escalate — always, immediately, without answering first:
- Any injury, illness or safety worry.
- Any refund, chargeback or "I was charged twice".
- Anything legal, or a waiver.
- A parent who is angry.
- Records that disagree with each other.
- Anything you are less than confident about.

Escalating is never the wrong call. Answering a worried parent wrongly is.

You cannot refund, change a price, override eligibility, adjust credits, or
confirm a booking. Do not offer to. If a parent asks for one of those, escalate
and tell them a person will come back to them today.`;
