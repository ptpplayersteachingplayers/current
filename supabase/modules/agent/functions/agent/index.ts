// =============================================================================
// POST /agent
// =============================================================================
// One turn of the conversation: read the thread, decide, call tools, reply.
//
// Called by the Quo and email webhooks after they have recorded the inbound
// message. It is a separate function so that a failure to think does not lose
// the message: the message is already saved and the thread already shows the
// family is waiting, whatever happens here.
// =============================================================================

import { asService } from "../../../../functions/_shared/db.ts";
import { json } from "../../../../functions/_shared/http.ts";
import { SYSTEM_PROMPT, TOOLS, runTool } from "../agent-tools.ts";

const MAX_TURNS = 6;

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });

  const secret = Deno.env.get("PTP_JOB_SECRET") ?? "";
  if (!secret || req.headers.get("x-ptp-job-secret") !== secret) {
    return new Response("Not found", { status: 404 });
  }

  const { conversation_id } = await req.json();
  const db = asService();

  const { data: conversation, error } = await db
    .from("conversations")
    .select("id, household_id, contact_id, channel, human_owned, agent_state")
    .eq("id", conversation_id)
    .single();

  if (error) return json({ error: "Unknown conversation" }, 404);

  // A person has this thread. The agent does not talk over them, and does not
  // need to be told twice.
  if (conversation.human_owned) return json({ skipped: "human_owned" });

  const { data: paused } = await db.rpc("automation_paused");
  if (paused) return json({ skipped: "automation_paused" });

  // The last of the thread, oldest first. Enough for the model to follow the
  // conversation; not so much that a long history crowds out the tool results
  // that are actually current.
  const { data: history } = await db
    .from("messages")
    .select("direction, body, created_at")
    .eq("conversation_id", conversation_id)
    .order("created_at", { ascending: false })
    .limit(12);

  const messages: Array<Record<string, unknown>> = (history ?? [])
    .reverse()
    .map((m) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body,
    }));

  const latest = (history ?? [])[0];

  // The escalation triggers are checked in SQL before the model sees the
  // message. An injury goes to a person whether or not the model recognises it
  // as one — the escalation must not depend on the thing being escalated about.
  const { data: mustEscalate } = await db.rpc("must_escalate", { p_body: latest?.body ?? "" });

  if (mustEscalate) {
    await db.rpc("escalate_conversation", {
      p_conversation_id: conversation_id,
      p_reason: mustEscalate,
      p_summary: `Parent message matched the ${mustEscalate} rule`,
      p_severity: mustEscalate === "safety" ? "urgent" : "normal",
      p_recommended_action: "Read the thread and reply personally",
      p_detail: { matched: mustEscalate },
    });

    await db.rpc("queue_outbound_message", {
      p_conversation_id: conversation_id,
      p_body: "Thanks for telling us — one of the team is picking this up now and will come back to you shortly.",
      p_dedupe_key: `escalated:${conversation_id}:${latest?.created_at}`,
      p_sender_kind: "ai",
      p_context: {},
      p_transactional: true,
    });

    return json({ escalated: mustEscalate });
  }

  const context = { conversationId: conversation_id, householdId: conversation.household_id };
  const calls: Array<Record<string, unknown>> = [];

  let reply: string | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callModel(messages);

    if (!response) {
      // The model is unavailable. A parent waiting on an answer is better
      // served by a person than by silence.
      await db.rpc("escalate_conversation", {
        p_conversation_id: conversation_id,
        p_reason: "unclear",
        p_summary: "The assistant could not be reached; the family is waiting",
        p_severity: "normal",
        p_recommended_action: "Reply by hand",
        p_detail: {},
      });
      return json({ escalated: "model_unavailable" });
    }

    const toolUses = (response.content ?? []).filter((b: AnthropicBlock) => b.type === "tool_use");
    const text = (response.content ?? [])
      .filter((b: AnthropicBlock) => b.type === "text")
      .map((b: AnthropicBlock) => b.text)
      .join("")
      .trim();

    if (toolUses.length === 0) {
      reply = text;
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const results = [];
    for (const use of toolUses) {
      const outcome = await runTool(use.name!, use.input ?? {}, context);
      calls.push({ tool: use.name, ok: outcome.ok });

      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(outcome.ok ? outcome.data ?? { ok: true } : { error: outcome.error }),
        is_error: !outcome.ok,
      });

      // escalate ends the turn: the thread now belongs to a person, and
      // anything else the model was going to say would be talking over them.
      if (use.name === "escalate" && outcome.ok) {
        return json({ escalated: true, tools: calls });
      }
    }

    messages.push({ role: "user", content: results });
  }

  if (!reply) {
    // Six turns without an answer means it is going in circles.
    await db.rpc("escalate_conversation", {
      p_conversation_id: conversation_id,
      p_reason: "unclear",
      p_summary: "The assistant could not reach an answer after several attempts",
      p_severity: "normal",
      p_recommended_action: "Read the thread and reply personally",
      p_detail: { tool_calls: calls },
    });
    return json({ escalated: "no_answer", tools: calls });
  }

  const { error: sendError } = await db.rpc("queue_outbound_message", {
    p_conversation_id: conversation_id,
    p_body: reply,
    p_dedupe_key: `agent:${conversation_id}:${latest?.created_at}`,
    p_sender_kind: "ai",
    p_context: {},
    p_transactional: false,
  });

  // Consent, quiet hours or the pause switch. Not an error — the message is
  // simply not ours to send, and the reason is already in the database.
  if (sendError) return json({ held: sendError.message, tools: calls });

  return json({ replied: true, tools: calls });
});

async function callModel(messages: Array<Record<string, unknown>>) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: Deno.env.get("PTP_AGENT_MODEL") ?? "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      messages,
    }),
  });

  if (!response.ok) {
    console.error("model call failed", response.status, await response.text());
    return null;
  }

  return await response.json();
}
