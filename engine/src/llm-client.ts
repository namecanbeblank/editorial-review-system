import Anthropic from "@anthropic-ai/sdk";

/**
 * Minimal client abstraction over the Anthropic Messages API, shared by the Tier 2
 * (paragraph) and Tier 3 (document audit) callers.
 *
 * Deliberately NOT the full `Anthropic` SDK client surface: `AnthropicMessagesClient`
 * exposes exactly one method (`messages.create`) and only the request/response fields
 * either caller actually sends or reads. Two reasons this earns its own type instead of
 * importing the SDK's own `Anthropic.Message` / `Anthropic.MessageCreateParams*` everywhere:
 *
 *   1. Test fixtures construct fake clients by hand (`{ messages: { create: async () =>
 *      ({...}) } }`); a minimal shape means a fixture only has to fill in the handful of
 *      fields the caller reads, not every field the real SDK's `Message` type requires
 *      (id, model, role, container, usage, ...).
 *   2. tier2/tier3's request-building logic stays decoupled from the exact SDK version's
 *      type names, so an SDK upgrade can't silently change caller.ts's compile surface.
 *
 * `defaultClient()` is the ONLY place in the engine that imports and touches the real SDK
 * types -- it constructs `new Anthropic()` (zero-arg: resolves ANTHROPIC_API_KEY, or an
 * `ant auth login` profile, from the environment per the SDK's own precedence) and adapts
 * it to `AnthropicMessagesClient`. Every other line of tier2/tier3 code, and every test,
 * works against the minimal interface only -- no SDK import, no network possible.
 */

/** One system-prompt content block. `cache_control` is set on exactly the block that
 *  should anchor a prompt-cache breakpoint (see tier2/caller.ts's workspace-block
 *  placement, and tier3/caller.ts which never sets it -- a single-call-per-document lane
 *  has nothing to reuse a cache read against). */
export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface UserMessage {
  role: "user";
  content: string;
}

/** P5.4: per-panel model assignment puts conversion/prose/title on Sonnet 5, which runs
 *  adaptive thinking by default and shares max_tokens between thinking and the response
 *  -- the exact silent-truncation bug already hit once on tier3 (see tier3/caller.ts).
 *  `{type: "disabled"}` is the only variant this engine ever sends; nothing here needs
 *  Sonnet's other thinking modes. */
export interface ThinkingConfig {
  type: "disabled";
}

export interface OutputConfig {
  format: { type: "json_schema"; schema: Record<string, unknown> };
  /** Sonnet-5 panel calls pair thinking:disabled with effort:"low" per
   *  rules/inventory.md's "Per-panel model assignment" ruling; omitted for Haiku calls. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface CreateMessageParams {
  model: string;
  max_tokens: number;
  system?: string | SystemBlock[];
  messages: UserMessage[];
  /** No temperature/top_p/top_k field exists on this type at all, on purpose -- Sonnet 5
   *  rejects them outright and Haiku calls never needed them either. */
  thinking?: ThinkingConfig;
  output_config: OutputConfig;
}

/** Only the two response fields either caller reads: the content blocks (to find the
 *  structured-output JSON in the first text block) and stop_reason (to notice
 *  truncation). Deliberately loose (`type: string`, not the SDK's ContentBlock union) so
 *  test fixtures can hand-construct a response without importing SDK types either. */
export interface ContentBlockLike {
  type: string;
  text?: string;
}

/** Wave 2 (PLAN.md P6): the two `Message.usage` fields the app's server-side session
 *  cost meter needs. The real SDK's `Usage` type carries several more (cache/server-tool/
 *  service-tier breakdowns) -- deliberately not surfaced here, same "only what a caller
 *  actually reads" philosophy as the rest of this file's minimal types. */
export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
}

export interface CreateMessageResult {
  content: ContentBlockLike[];
  stop_reason: string | null;
  /** Optional so every hand-built test fixture that predates this field (the whole of
   *  tier2/tier3's existing test suites) keeps compiling unchanged. `defaultClient()`
   *  below always populates it -- the real SDK's `Message.usage` is non-optional. */
  usage?: UsageLike;
}

export interface AnthropicMessagesClient {
  messages: {
    create(params: CreateMessageParams): Promise<CreateMessageResult>;
  };
}

/** Adapts the real SDK client to the minimal interface. The only function in the engine
 *  that imports Anthropic's own request/response types (Anthropic.MessageCreateParamsNonStreaming,
 *  Anthropic.Message) -- verified structurally compatible with CreateMessageParams /
 *  CreateMessageResult against the installed SDK version, no casts needed. */
export function defaultClient(): AnthropicMessagesClient {
  const sdk = new Anthropic();
  return {
    messages: {
      async create(params: CreateMessageParams): Promise<CreateMessageResult> {
        const sdkParams: Anthropic.MessageCreateParamsNonStreaming = {
          model: params.model,
          max_tokens: params.max_tokens,
          system: params.system,
          messages: params.messages,
          thinking: params.thinking,
          output_config: params.output_config,
        };
        const message: Anthropic.Message = await sdk.messages.create(sdkParams);
        return {
          content: message.content,
          stop_reason: message.stop_reason,
          usage: {
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
          },
        };
      },
    },
  };
}

/**
 * Re-export of the real SDK class, for the eval/ batch scripts ONLY (P5.2). Those
 * scripts need `client.messages.batches.*` (create/retrieve/results) -- a surface
 * `AnthropicMessagesClient` deliberately does not cover, since batches aren't part of
 * the tested live-call path (tier2/tier3's `runTier2`/`runAudit` never call them). No
 * tier2/tier3 caller code, and no test, uses this export -- it exists solely so
 * eval/llm-batch.mjs and eval/llm-batch-collect.mjs (which live outside engine/ and so
 * can't resolve "@anthropic-ai/sdk" via their own node_modules lookup -- there is no
 * root-level package.json/node_modules in this repo) can reach the SDK through
 * engine/dist/, exactly like they already reach runTier2/runAudit.
 */
export { default as AnthropicSdk } from "@anthropic-ai/sdk";
