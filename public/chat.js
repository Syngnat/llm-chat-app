/**
 * LLM Chat App Frontend - FINAL VERSION
 *
 * Handles UI interactions and communication with the backend API,
 * including model selection and robust stream processing.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
// 新增：获取模型选择下拉框的元素
const modelSelector = document.getElementById("model");

// Chat state
let chatHistory = []; // 为了保持会话干净，我们每次都从头构建
let isProcessing = false;

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

// 初始化时添加欢迎语
addMessageToChat(
  "assistant",
  "Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?"
);

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
  const message = userInput.value.trim();
  if (message === "" || isProcessing) return;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  addMessageToChat("user", message);
  chatHistory.push({ role: 'user', content: message });

  userInput.value = "";
  typingIndicator.classList.add("visible");

  try {
    // 新增：获取用户当前选择的模型
    const selectedModel = modelSelector.value;

    const assistantMessageEl = addMessageToChat("assistant", ""); // 创建一个空的AI消息气泡
    let responseText = "";

    // Send request to API
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // 修改：将选择的模型名称和聊天历史一起发送
        model: selectedModel,
        messages: chatHistory,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get response. Status: ${response.status}`);
    }

    typingIndicator.classList.remove("visible");

    // Process streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // 修改：使用更健壮的逻辑来解析标准的SSE数据流
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const dataStr = line.substring(5).trim();
            if (dataStr === '[DONE]') break;
            const jsonData = JSON.parse(dataStr);
            if (jsonData.response) {
              responseText += jsonData.response;
              assistantMessageEl.textContent = responseText;
              chatMessages.scrollTop = chatMessages.scrollHeight;
            }
          } catch (e) {
            // 忽略JSON解析错误，因为数据块可能不完整
          }
        }
      }
    }
    // 将完整的AI回复添加到历史记录
    chatHistory.push({ role: 'assistant', content: responseText });

  } catch (error) {
    console.error("Error:", error);
    addMessageToChat("assistant", `Sorry, there was an error: ${error.message}`);
    typingIndicator.classList.remove("visible");
  } finally {
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

/**
 * Helper function to add message to chat
 * @returns {HTMLElement} The created message element's content paragraph.
 */
function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  messageEl.textContent = content; // 直接设置文本内容
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return messageEl; // 返回这个消息元素，以便后续更新
}