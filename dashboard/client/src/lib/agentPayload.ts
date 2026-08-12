/**
 * Helpers for reading payloads produced by Solace Agent Mesh agents.
 *
 * Agents are instructed to reply with a bare JSON object, and their config
 * declares an outputSchema, but LLM output is not deterministic: models
 * routinely wrap JSON in a ```json fence anyway. When that happens the broker
 * message body is a JSON *string* containing the fenced block rather than a
 * JSON object, and every consumer that expects an object silently breaks.
 *
 * Rather than let a stray fence take the dashboard down, unwrap it here.
 */

/**
 * If `obj` is a SAM A2A task envelope (from an event-mesh workflow target
 * with responseType: full), pull the workflow's result out of
 * status.message.parts[*].data. Returns null when `obj` is not that shape,
 * so bare agent responses pass straight through untouched.
 */
function extractWorkflowData(obj: Record<string, any>): Record<string, any> | null {
  const parts = obj?.status?.message?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const data = part?.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // The workflow output_mapping result carries the briefing fields; an
      // intermediate/status data part won't. Require at least one known field.
      if ('category' in data || 'headline' in data || 'sentiment' in data || 'summary' in data) {
        return data as Record<string, any>;
      }
    }
  }
  return null;
}

/** Strips a leading/trailing markdown code fence, if present. */
function stripCodeFence(text: string): string {
  const fenced = text
    .trim()
    .match(/^```(?:json|JSON)?\s*\r?\n?([\s\S]*?)\r?\n?```$/);
  return fenced ? fenced[1].trim() : text.trim();
}

/**
 * Normalizes an already-JSON.parse'd broker payload into an object.
 *
 * Returns the value unchanged when it is already an object. When it is a
 * string, attempts to recover an object from it (handling code fences and
 * surrounding prose). Returns null when nothing object-shaped can be found.
 */
export function unwrapAgentPayload(payload: unknown): Record<string, any> | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    // Event-mesh WORKFLOW targets (successOutput.responseType: full) publish
    // the whole A2A task object, not the bare result. The workflow's
    // output_mapping result is nested at status.message.parts[*].data. An
    // agent target, by contrast, publishes the bare object directly - so only
    // dig in when this actually looks like the task envelope.
    const workflowData = extractWorkflowData(payload as Record<string, any>);
    if (workflowData) return workflowData;
    return payload as Record<string, any>;
  }

  if (typeof payload !== 'string') return null;

  const candidate = stripCodeFence(payload);

  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // Fall through to a best-effort scan for an embedded object.
  }

  // Last resort: the model added prose around the JSON. Take the widest
  // {...} span and try that.
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      // Give up - caller decides how to report it.
    }
  }

  return null;
}
