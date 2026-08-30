import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "../../src/ai/providers/anthropic";
import { createOllamaProvider } from "../../src/ai/providers/ollama";
import { createOpenAiProvider } from "../../src/ai/providers/openai";
import { resolveAiProvider } from "../../src/ai/providerFactory";
import type { Fetcher } from "../../src/ai/types";

const REQUEST = {
  systemPrompt: "You are a helpful analyst.",
  userPrompt: "Explain the numbers.",
};

describe("Ollama provider", () => {
  it("returns the generated text on success", async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ response: "Net worth rose because of X." }),
    });
    const provider = createOllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
      fetcher,
    });
    const result = await provider.generate(REQUEST);
    expect(result.kind).toBe("ok");
  });

  it("reports insufficient-data when Ollama is not running, without throwing", async () => {
    const fetcher: Fetcher = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    };
    const provider = createOllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
      fetcher,
    });
    const result = await provider.generate(REQUEST);
    expect(result.kind).toBe("insufficient-data");
    if (result.kind === "insufficient-data") {
      expect(result.reasons.join()).toContain("installed and running locally");
    }
  });

  it("reports insufficient-data on an explicit Ollama error", async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: "model 'llama3.1' not found" }),
    });
    const provider = createOllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
      fetcher,
    });
    expect((await provider.generate(REQUEST)).kind).toBe("insufficient-data");
  });

  it("reports insufficient-data on a non-200 response", async () => {
    const fetcher: Fetcher = async () => ({
      ok: false,
      status: 500,
      text: async () => "",
    });
    const provider = createOllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
      fetcher,
    });
    expect((await provider.generate(REQUEST)).kind).toBe("insufficient-data");
  });
});

describe("OpenAI provider", () => {
  it("returns the message content on success", async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "Explanation text." } }] }),
    });
    const provider = createOpenAiProvider({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetcher,
    });
    expect((await provider.generate(REQUEST)).kind).toBe("ok");
  });

  it("reports insufficient-data on an API error payload", async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: { message: "invalid_api_key" } }),
    });
    const provider = createOpenAiProvider({
      apiKey: "sk-bad",
      model: "gpt-4o-mini",
      fetcher,
    });
    expect((await provider.generate(REQUEST)).kind).toBe("insufficient-data");
  });
});

describe("Anthropic provider", () => {
  it("returns the first text content block on success", async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ content: [{ type: "text", text: "Explanation text." }] }),
    });
    const provider = createAnthropicProvider({
      apiKey: "sk-ant-test",
      model: "claude-3-5-haiku-latest",
      fetcher,
    });
    expect((await provider.generate(REQUEST)).kind).toBe("ok");
  });

  it("reports insufficient-data when no text block is present", async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [] }),
    });
    const provider = createAnthropicProvider({
      apiKey: "sk-ant-test",
      model: "claude-3-5-haiku-latest",
      fetcher,
    });
    expect((await provider.generate(REQUEST)).kind).toBe("insufficient-data");
  });
});

describe("provider selection", () => {
  const fetcher: Fetcher = async () => ({
    ok: true,
    status: 200,
    text: async () => "{}",
  });

  it("defaults to Ollama when AI_PROVIDER is unset", () => {
    expect(resolveAiProvider({}, fetcher)?.name).toBe("ollama");
  });

  it("defaults to Ollama on an unrecognized value, rather than failing silently", () => {
    expect(resolveAiProvider({ AI_PROVIDER: "something-else" }, fetcher)?.name).toBe(
      "ollama",
    );
  });

  it("selects OpenAI only when a key is present", () => {
    expect(resolveAiProvider({ AI_PROVIDER: "openai" }, fetcher)).toBeNull();
    expect(
      resolveAiProvider({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-x" }, fetcher)?.name,
    ).toBe("openai");
  });

  it("selects Anthropic only when a key is present", () => {
    expect(resolveAiProvider({ AI_PROVIDER: "anthropic" }, fetcher)).toBeNull();
    expect(
      resolveAiProvider(
        { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-x" },
        fetcher,
      )?.name,
    ).toBe("anthropic");
  });
});
