// src/index.ts

import { Ai } from '@cloudflare/ai';
import { Env, ChatMessage } from './types';

// --- 配置常量 ---
const LLAMA_MODEL_ID: any = "@cf/meta/llama-3.1-8b-instruct";
const SYSTEM_PROMPT = "You are a helpful, friendly assistant.";
const GEMINI_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/f2128e62b71b328cddb70252e4e5f05e/gemini/google-ai-studio/v1beta/models/gemini-2.5-flash:streamGenerateContent';

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
    const requestBody = await request.json<{ model?: string; systemPrompt?: string; messages: ChatMessage[] }>();
    const model = requestBody.model || 'llama';
    
    const signal = request.signal; 

    if (model.toLowerCase().includes('gemini')) {
      return handleGeminiRequest(requestBody, env, signal); 
    } else {
      return handleLlamaRequest(requestBody, env, signal); 
    }
  } catch (error) {
    return new Response("Invalid request body", { status: 400 });
  }
}

// --- Llama 模型处理器 ---
async function handleLlamaRequest(body: { systemPrompt?: string; messages: ChatMessage[] }, env: Env, signal?: AbortSignal): Promise<Response> {
  const ai = new Ai(env.AI);
  const { messages = [], systemPrompt } = body; 
  
  const finalSystemPrompt = systemPrompt || SYSTEM_PROMPT;
  if (!messages.some((msg) => msg.role === "system")) {
    messages.unshift({ role: "system", content: finalSystemPrompt });
  }

  const responseStream = await ai.run(LLAMA_MODEL_ID, { messages, stream: true }) as any;
  return new Response(responseStream, { headers: { 'content-type': 'text/event-stream' } });
}

// --- Gemini 模型处理器 (务实稳定版) ---
async function handleGeminiRequest(body: { systemPrompt?: string; messages: ChatMessage[] }, env: Env, signal?: AbortSignal): Promise<Response> {
  const { messages = [], systemPrompt } = body; 
  const geminiMessages = messages.map(msg => {
    if (msg.role === 'system') return null;
    if (msg.role === 'assistant') return { role: 'model', parts: [{ text: msg.content }] };
    return { role: 'user', parts: [{ text: msg.content }] };
  }).filter(Boolean) as ({
    role: string;
    parts: {
        text: string;
    }[];
})[];

  if (geminiMessages.length === 0 || geminiMessages[geminiMessages.length -1].role !== 'user') {
    return new Response(JSON.stringify({ error: "Invalid history for Gemini" }), { status: 400 });
  }

  const geminiPayload = { contents: geminiMessages };

  try {
    const geminiResponse = await fetch(GEMINI_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'AIzaSyAHNAY-pb8EqB5mR9aV9MV4k0dcIlHSAnw' },
      body: JSON.stringify(geminiPayload),
      signal: signal, // 将 signal 传递给 fetch
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error(`[Gemini API Error] Status: ${geminiResponse.status}, Body: ${errorBody}`);
      return new Response(JSON.stringify({ error: `Gemini API Error: ${errorBody}` }), { status: 500 });
    }

    const responseData: any | any[] = await geminiResponse.json(); 
    let fullResponseText = "";
    if (Array.isArray(responseData)) {
        for (const item of responseData) {
            const textPart = (item as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof textPart === 'string') {
                fullResponseText += textPart;
            }
        }
    } else {
        const textPart = (responseData as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof textPart === 'string') {
            fullResponseText += textPart;
        }
    }

    const sseChunk = { response: fullResponseText };
    const sseFormatted = `data: ${JSON.stringify(sseChunk)}\n\n`;

    return new Response(new TextEncoder().encode(sseFormatted), {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
    });

  } catch (e: any) {
    if (e.name === 'AbortError') {
        console.log("Backend fetch aborted successfully.");
        return new Response("Request aborted", { status: 499 });
    }
    console.error(`Fatal error in handleGeminiRequest: ${e.message}`, e);
    return new Response(JSON.stringify({ error: `Fatal Error: ${e.message}` }), { status: 500 });
  }
}