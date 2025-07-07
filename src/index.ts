// src/index.ts

import { Ai } from '@cloudflare/ai';
import { Env, ChatMessage } from './types';

// --- 配置常量 ---
const LLAMA_MODEL_ID = "@cf/meta/llama-3.1-8b-instruct";
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
    // START: Key Change - Expect systemPrompt from the frontend
    const requestBody = await request.json<{ model?: string; systemPrompt?: string; messages: ChatMessage[] }>();
    // END: Key Change
    const model = requestBody.model || 'llama';

    if (model.toLowerCase().includes('gemini')) {
      return handleGeminiRequest(requestBody, env);
    } else {
      return handleLlamaRequest(requestBody, env);
    }
  } catch (error) {
    return new Response("Invalid request body", { status: 400 });
  }
}

// --- Llama 模型处理器 ---
async function handleLlamaRequest(body: { systemPrompt?: string; messages: ChatMessage[] }, env: Env): Promise<Response> {
  const ai = new Ai(env.AI);
  const { messages = [], systemPrompt } = body;
  
  // START: Key Change - Use custom prompt if provided, otherwise use default
  const finalSystemPrompt = systemPrompt || SYSTEM_PROMPT;
  if (!messages.some((msg) => msg.role === "system")) {
    messages.unshift({ role: "system", content: finalSystemPrompt });
  }
  // END: Key Change

  const responseStream = await ai.run(LLAMA_MODEL_ID, { messages, stream: true });
  return new Response(responseStream, { headers: { 'content-type': 'text/event-stream' } });
}

// --- Gemini 模型处理器 (务实稳定版) ---
async function handleGeminiRequest(body: { messages: ChatMessage[] }, env: Env): Promise<Response> {
  const { messages = [] } = body;
  const geminiMessages = messages.map(msg => {
    if (msg.role === 'system') return null; // Gemini没有system角色，忽略
    if (msg.role === 'assistant') return { role: 'model', parts: [{ text: msg.content }] };
    return { role: 'user', parts: [{ text: msg.content }] };
  }).filter(Boolean);

  if (geminiMessages.length === 0 || geminiMessages[0].role !== 'user') {
    return new Response(JSON.stringify({ error: "Invalid history for Gemini" }), { status: 400 });
  }

  const geminiPayload = { contents: geminiMessages };

  try {
    const geminiResponse = await fetch(GEMINI_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'AIzaSyAHNAY-pb8EqB5mR9aV9MV4k0dcIlHSAnw' },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiResponse.ok) { // 检查HTTP状态码
      const errorBody = await geminiResponse.text();
      console.error(`[Gemini Error] Status: ${geminiResponse.status}, Body: ${errorBody}`);
      return new Response(JSON.stringify({ error: `Gemini API Error: ${errorBody}` }), { status: 500 });
    }

    // 【关键修复】直接读取整个响应体，因为Gateway不是真正的流式转发
    const responseData = await geminiResponse.json(); 
    
    let fullResponseText = "";
    // 如果返回的是一个数组 (像您之前日志里那样)
    if (Array.isArray(responseData)) {
        for (const item of responseData) {
            const textPart = item?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof textPart === 'string') {
                fullResponseText += textPart;
            }
        }
    } else { // 如果返回的是单个对象
        const textPart = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof textPart === 'string') {
            fullResponseText += textPart;
        }
    }

    // 将完整的文本封装成一个SSE事件，一次性发送给前端
    const sseChunk = { response: fullResponseText };
    const sseFormatted = `data: ${JSON.stringify(sseChunk)}\n\n`;

    return new Response(new TextEncoder().encode(sseFormatted), {
      headers: { 
        'content-type': 'text/event-stream', 
        'cache-control': 'no-cache', // 确保浏览器不缓存
      }
    });

  } catch (e: any) {
    console.error(`Fatal error in handleGeminiRequest: ${e.message}`, e);
    return new Response(JSON.stringify({ error: `Fatal Error: ${e.message}` }), { status: 500 });
  }
}