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

// --- Gemini 模型处理器 (终极提示词生效版) ---
async function handleGeminiRequest(body: { systemPrompt?: string; messages: ChatMessage[] }, env: Env): Promise<Response> {
  const { messages = [], systemPrompt } = body;

  // **【关键修复：重新构建 Gemini 消息数组】**
  let geminiContents: { role: string; parts: { text: string }[] }[] = [];

  // 1. 如果存在系统提示词，将其作为对话的第一个用户消息注入
  if (systemPrompt && systemPrompt.trim() !== '') {
    geminiContents.push({ role: 'user', parts: [{ text: `[系统指令]: ${systemPrompt.trim()}` }] });
    // 为了满足 Gemini 的 user/model 交替要求，添加一个空的 model 响应
    geminiContents.push({ role: 'model', parts: [{ text: '好的，我已理解您的指令。' }] }); // 可以是空字符串，这里为了清晰加了回复
  }

  // 2. 遍历实际的聊天历史，并转换为 Gemini 的格式
  for (const msg of messages) {
    if (msg.role === 'user') {
      geminiContents.push({ role: 'user', parts: [{ text: msg.content }] });
    } else if (msg.role === 'assistant') { // 注意：将 assistant 映射为 model
      geminiContents.push({ role: 'model', parts: [{ text: msg.content }] });
    }
    // 忽略原始 messages 中的 'system' 角色，因为我们已经通过 systemPrompt 处理了
  }

  // 检查确保至少有一个用户消息（防止只有系统提示词而没有实际用户提问）
  if (geminiContents.length === 0 || geminiContents[geminiContents.length - 1].role !== 'user') {
      // 这是一个安全检查，确保最后一条消息是用户，或者至少有用户消息。
      // 否则，如果只设置了systemPrompt但没有实际用户输入，可能会导致API问题
      // 实际上，如果前端按预期发送了 messages，这里不会触发
  }

  const geminiPayload = { contents: geminiContents };

  try {
    const geminiResponse = await fetch(GEMINI_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'AIzaSyAHNAY-pb8EqB5mR9aV9MV4k0dcIlHSAnw' },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error(`[Gemini API Error] Status: ${geminiResponse.status}, Body: ${errorBody}`);
      return new Response(JSON.stringify({ error: `Gemini API Error: ${errorBody}` }), { status: 500 });
    }

    // 【保持前端模拟流式所需的后端一次性发送逻辑】
    const responseData = await geminiResponse.json(); 
    let fullResponseText = "";
    if (Array.isArray(responseData)) {
        for (const item of responseData) {
            const textPart = item?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof textPart === 'string') {
                fullResponseText += textPart;
            }
        }
    } else { 
        const textPart = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
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
    console.error(`Fatal error in handleGeminiRequest: ${e.message}`, e);
    return new Response(JSON.stringify({ error: `Fatal Error: ${e.message}` }), { status: 500 });
  }
}