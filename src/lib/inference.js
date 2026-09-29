import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

/**
 * Client for DigitalOcean's serverless inference service.
 *
 * The service speaks the Anthropic Messages API at
 * https://inference.do-ai.run/v1/messages and accepts either `x-api-key` or
 * `Authorization: Bearer`, so the official Anthropic SDK works unmodified with
 * nothing but a baseURL swap. Model ids are DigitalOcean slugs
 * (`anthropic-claude-opus-5`), not Anthropic's own ids — see
 * `doctl serverless-inference models list`.
 *
 * Point INFERENCE_BASE_URL at api.anthropic.com and use an Anthropic model id
 * if you ever need to bypass DigitalOcean; nothing else changes.
 */
let client = null;

export function inference() {
  if (!client) {
    client = new Anthropic({
      apiKey: config.inference.apiKey,
      baseURL: config.inference.baseUrl,
      maxRetries: 3,
      timeout: 60_000,
    });
  }
  return client;
}

/** Reachability + credential check. Used by `/healthz?deep=1`. */
export async function pingInference() {
  const res = await inference().messages.create({
    model: config.inference.model,
    max_tokens: 4,
    messages: [{ role: 'user', content: 'ok' }],
  });
  return { model: res.model, ok: true };
}
