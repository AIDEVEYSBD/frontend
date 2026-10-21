import { describe, expect, it } from "vitest";
import { DEFAULT_EMBEDDING_MODEL, embedConfig, embeddingsUrl, endpointHost } from "@/lib/embed-config";

/**
 * Where embeddings come from, as a pure function of the environment: a
 * provider-neutral endpoint when one is named, the model gateway's when
 * not, the key from its own variable, the vault or the gateway, in that
 * order. lib/server/embed.ts feeds it process.env and the vault.
 */

describe("embeddingsUrl", () => {
  it("lands a base, a chat URL or the embeddings URL itself on /embeddings", () => {
    expect(embeddingsUrl("https://host/openai/v1")).toBe("https://host/openai/v1/embeddings");
    expect(embeddingsUrl("https://host/openai/v1/")).toBe("https://host/openai/v1/embeddings");
    expect(embeddingsUrl("https://host/openai/v1/chat/completions")).toBe("https://host/openai/v1/embeddings");
    expect(embeddingsUrl("https://host/openai/v1/embeddings")).toBe("https://host/openai/v1/embeddings");
    expect(embeddingsUrl("http://ollama.local:11434/v1/completions")).toBe("http://ollama.local:11434/v1/embeddings");
    expect(embeddingsUrl("  ")).toBe("");
  });
});

describe("embedConfig", () => {
  it("prefers the embedding variables when set", () => {
    const c = embedConfig({
      EMBEDDING_ENDPOINT: "https://embed.example/v1",
      EMBEDDING_API_KEY: "emb-key-12345678",
      EMBEDDING_MODEL: "nomic-embed-text",
      FOUNDRY_ENDPOINT: "https://foundry.example/openai/v1/chat/completions",
      FOUNDRY_API_KEY: "foundry-key-1234",
    });
    expect(c).toEqual({ endpoint: "https://embed.example/v1/embeddings", key: "emb-key-12345678", model: "nomic-embed-text", endpointSource: "embedding", keySource: "embedding" });
  });

  it("falls back to the model gateway's endpoint and key, as before", () => {
    const c = embedConfig({ FOUNDRY_ENDPOINT: "https://foundry.example/openai/v1/chat/completions", FOUNDRY_API_KEY: "foundry-key-1234" });
    expect(c.endpoint).toBe("https://foundry.example/openai/v1/embeddings");
    expect(c.key).toBe("foundry-key-1234");
    expect(c.model).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(c.endpointSource).toBe("foundry");
    expect(c.keySource).toBe("foundry");
  });

  it("takes the vault's key before the gateway's and after its own", () => {
    expect(embedConfig({ EMBEDDING_ENDPOINT: "https://e.example", FOUNDRY_API_KEY: "foundry-key-1234" }, "vault-key-123456").keySource).toBe("vault");
    expect(embedConfig({ EMBEDDING_ENDPOINT: "https://e.example", EMBEDDING_API_KEY: "own-key-12345678" }, "vault-key-123456")).toMatchObject({ key: "own-key-12345678", keySource: "embedding" });
    expect(embedConfig({ EMBEDDING_ENDPOINT: "https://e.example", AZURE_AI_KEY: "azure-key-1234" })).toMatchObject({ key: "azure-key-1234", keySource: "foundry" });
  });

  it("is honest when nothing is configured", () => {
    expect(embedConfig({})).toEqual({ endpoint: "", key: "", model: DEFAULT_EMBEDDING_MODEL, endpointSource: "none", keySource: "none" });
    expect(embedConfig({ EMBEDDING_ENDPOINT: "https://e.example" }).keySource).toBe("none");
    expect(embedConfig({ EMBEDDING_MODEL: "  " }).model).toBe(DEFAULT_EMBEDDING_MODEL);
  });
});

describe("endpointHost", () => {
  it("names the host and nothing else", () => {
    expect(endpointHost("https://embed.example:8443/v1/embeddings?key=x")).toBe("embed.example:8443");
    expect(endpointHost("")).toBe("");
    expect(endpointHost("not a url")).toBe("");
  });
});
