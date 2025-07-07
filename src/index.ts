// src/index.ts

import { Ai } from '@cloudflare/ai';
import { Env, ChatMessage } from './types';

// --- 配置常量 ---
const LLAMA_MODEL_ID = "@cf/meta/llama-3.1-8b-instruct";
const SYSTEM_PROMPT = "You are a helpful, friendly assistant.";
// 请确保这里的 Gateway ID 是您自己的
const GEMINI_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/f2128e62b71b328cddb70252e4e5f05e/gemini/v1/models/gemini-2.5-flash:streamGenerateContent';

// --- 主处理逻辑 ---
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChatRequest(request, env);
    }
    return new Response("Not found", { status: 404 });
  }
};

// --- 聊天请求分发器 ---
async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    const requestBody = await request.json<{ model?: string; messages: ChatMessage[] }>();
    const model = requestBody.model || 'llama';
    if (model.toLowerCase().includes('gemini')) {
      return handleGeminiRequest(requestBody, env);
    } else {
      return handleLlamaRequest(requestBody, env);
    }
  } catch (error) {
    console.error("Invalid request:", error);
    return new Response("Invalid request body", { status: 400 });
  }
}

// --- Llama 模型处理器 ---
async function handleLlamaRequest(body: { messages: ChatMessage[] }, env: Env): Promise<Response> {
  const ai = new Ai(env.AI);
  const { messages = [] } = body;
  if (!messages.some((msg) => msg.role === "system")) {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }
  const responseStream = await ai.run(LLAMA_MODEL_ID, { messages, stream: true });
  return new Response(responseStream, { headers: { 'content-type': 'text/event-stream' } });
}

// --- Gemini 模型处理器 ---
async function handleGeminiRequest(body: { messages: ChatMessage[] }, env: Env): Promise<Response> {
  const { messages = [] } = body;
  const geminiMessages = messages.map(msg => {
    if (msg.role === 'system') return { role: 'user', parts: [{ text: `System Instruction: ${msg.content}` }] };
    if (msg.role === 'assistant') return { role: 'model', parts: [{ text: msg.content }] };
    return { role: 'user', parts: [{ text: msg.content }] };
  }).filter(Boolean);

  const geminiPayload = { contents: geminiMessages };
  const geminiResponse = await fetch(GEMINI_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.GOOGLE_API_KEY,
    },
    body: JSON.stringify(geminiPayload),
  });

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      const decodedChunk = new TextDecoder().decode(chunk);
      try {
        const lines = decodedChunk.replace(/^data: /, '').trim().split('\n');
        for (const line of lines) {
          if (line.trim() === '') continue;
          const parsed = JSON.parse(line);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) {
            const sseChunk = { response: text };
            controller.enqueue(`data: ${JSON.stringify(sseChunk)}\n\n`);
          }
        }
      } catch (e) {}
    }
  });

  return new Response(geminiResponse.body?.pipeThrough(transformStream), {
    headers: { 'content-type': 'text/event-stream' }
  });
}