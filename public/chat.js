/**
 * LLM Chat App Frontend - FINAL PERFECTED VERSION with Simulated Streaming
 */

// DOM elements
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const chatMessages = document.getElementById('chat-messages');
const typingIndicator = document.getElementById('typing-indicator');
const modelSelector = document.getElementById('model');
const systemPromptInput = document.getElementById('system-prompt');

// Chat state
let conversationHistory = [];
let isProcessing = false;

// --- EVENT LISTENERS ---
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});
modelSelector.addEventListener('change', () => {
  resetChat();
});

// --- FUNCTIONS ---

function resetChat() {
  chatMessages.innerHTML = '';
  appendMessage("Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?", 'assistant');
  conversationHistory = [];
}

async function sendMessage() {
  const message = userInput.value.trim();
  if (message === "" || isProcessing) return;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;
  typingIndicator.classList.add("visible");

  // Add user message to UI and history
  appendMessage(message, 'user');
  const currentTurnMessages = [...conversationHistory, { role: 'user', content: message }];
  
  userInput.value = "";
  userInput.style.height = 'auto';

  try {
    const selectedModel = modelSelector.value;
    const systemPrompt = systemPromptInput.value.trim();

    // 【重要】后端 now returns a single, complete SSE chunk (as updated previously)
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        systemPrompt: systemPrompt,
        messages: currentTurnMessages,
      }),
    });

    if (!response.ok) { throw new Error(`API error: ${response.status} ${response.statusText}`); }

    typingIndicator.classList.remove("visible");
    
    // 【关键】创建AI消息的容器，我们只向这个元素的 .textContent 属性追加内容
    const aiMessageWrapper = document.createElement("div");
    aiMessageWrapper.className = `message assistant-message`;
    const aiMessageParagraph = document.createElement("p"); // Inside the wrapper, we put a <p> tag
    aiMessageWrapper.appendChild(aiMessageParagraph);
    chatMessages.appendChild(aiMessageWrapper);

    let aiResponseText = ""; // Accumulates the full plain text response

    // Read the *entire* response from the stream, as it's likely a single chunk from backend
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullBackendResponseChunk = ""; // Accumulate the entire backend stream here

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullBackendResponseChunk += decoder.decode(value, {stream: true});
    }

    // Now parse the *single* complete SSE chunk from the backend
    const lines = fullBackendResponseChunk.split('\n');
    for (const line of lines) {
        if (line.startsWith("data: ")) {
            try {
                const dataStr = line.substring(5).trim();
                if (dataStr === '[DONE]') continue; // If backend sends DONE, just ignore it
                const jsonData = JSON.parse(dataStr);
                if (jsonData.response) {
                    aiResponseText += jsonData.response; // Accumulate the full text
                }
            } catch (e) {
                console.error("Error parsing backend SSE:", e);
            }
        }
    }

    // **【核心：前端模拟打字机效果】**
    const finalRenderedText = aiResponseText; // This is the complete text received
    aiMessageParagraph.textContent = ''; // Ensure it's empty to start typing effect
    let charIndex = 0;
    const typingSpeed = 20; // Adjust typing speed (milliseconds per character)

    const typeCharacter = () => {
        if (charIndex < finalRenderedText.length) {
            aiMessageParagraph.textContent += finalRenderedText.charAt(charIndex);
            charIndex++;
            chatMessages.scrollTop = chatMessages.scrollHeight; // Keep scrolling
            setTimeout(typeCharacter, typingSpeed);
        } else {
            // Once typing is complete, convert to Markdown
            aiMessageParagraph.innerHTML = DOMPurify.sanitize(marked.parse(finalRenderedText));
            chatMessages.scrollTop = chatMessages.scrollHeight; // Final scroll after Markdown
            
            // Add to conversation history after effect
            conversationHistory.push({ role: 'user', content: message });
            conversationHistory.push({ role: 'assistant', content: finalRenderedText });
            
            // Re-enable input
            isProcessing = false;
            userInput.disabled = false;
            sendButton.disabled = false;
            userInput.focus();
        }
    };
    typeCharacter(); // Start the typing animation

  } catch (error) {
    console.error("Error:", error);
    appendMessage(`Sorry, an error occurred: ${error.message}`, 'assistant');
    typingIndicator.classList.remove("visible");
    // Ensure inputs are re-enabled even on error
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

// Helper function to append message elements
function appendMessage(text, role) {
  const messageWrapper = document.createElement("div");
  messageWrapper.className = `message ${role}-message`;
  const messageParagraph = document.createElement("p");
  messageParagraph.textContent = text;
  messageWrapper.appendChild(messageParagraph);
  chatMessages.appendChild(messageWrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  // For AI messages, return the <p> element so we can update its textContent directly
  // For user messages, the wrapper is fine
  return role === 'assistant' ? messageParagraph : messageWrapper;
}

resetChat(); // Initialize chat on page load