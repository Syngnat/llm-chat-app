/**
 * LLM Chat App Frontend - THE FINAL FINAL PERFECTED VERSION
 *
 * Ensures correct form submission, simulated streaming, robust abort,
 * advanced prompt management, AND immediate typing animation stop.
 */

// DOM elements
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const cancelButton = document.getElementById('cancel-button'); 
const chatMessages = document.getElementById('chat-messages');
const typingIndicator = document.getElementById('typing-indicator');
const modelSelector = document.getElementById('model');
const systemPromptInput = document.getElementById('system-prompt');

// New: Store the timeout ID for the typing effect to clear it on abort
let typingTimeoutId = null; 

// Chat state
let conversationHistory = [];
let isProcessing = false;
let abortController = null; // To manage fetch request cancellation

// Predefined prompts
const PRESET_PROMPTS = {
  'default': "You are a helpful, friendly assistant.",
  'programmer': "You are a sarcastic but helpful programmer. Respond concisely and provide code examples when appropriate.",
  'pirate': "You are a helpful pirate. Speak like a pirate, using pirate vocabulary and phrases."
};
const CUSTOM_PROMPT_KEY = 'customLLMPrompt'; // localStorage key

// --- EVENT LISTENERS ---

// Auto-resize main chat textarea
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Auto-resize custom prompt textarea (inside modal)
if (document.getElementById('custom-prompt-editor')) { // Check if element exists before adding listener
  document.getElementById('custom-prompt-editor').addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
  });
}

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

cancelButton.addEventListener('click', () => {
  if (abortController) {
    abortController.abort(); // Signal to abort the fetch request
    console.log("Request aborted by user.");
    // Directly call cleanup here, as AbortController might not throw
    cleanupAfterCompletionOrAbort(); 
  }
});

// Prompt Management Event Listeners
if (document.getElementById('prompt-preset')) { // Check if elements exist
  document.getElementById('prompt-preset').addEventListener('change', () => {
    const selectedValue = document.getElementById('prompt-preset').value;
    if (selectedValue === 'custom') {
      showPromptModal();
    } else {
      resetChat(); 
    }
  });
}
if (document.getElementById('save-prompt-button')) {
  document.getElementById('save-prompt-button').addEventListener('click', () => {
    const customPrompt = document.getElementById('custom-prompt-editor').value.trim();
    localStorage.setItem(CUSTOM_PROMPT_KEY, customPrompt);
    hidePromptModal();
    resetChat(); 
  });
}
if (document.getElementById('cancel-prompt-button')) {
  document.getElementById('cancel-prompt-button').addEventListener('click', () => {
    if (document.getElementById('prompt-preset').value === 'custom') {
      document.getElementById('prompt-preset').value = 'default';
    }
    hidePromptModal();
  });
}
if (document.getElementById('prompt-modal-overlay')) {
  document.getElementById('prompt-modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('prompt-modal-overlay')) {
      if (document.getElementById('prompt-preset').value === 'custom') {
        document.getElementById('prompt-preset').value = 'default';
      }
      hidePromptModal();
    }
  });
}


// --- FUNCTIONS ---

// New: Cleanup function to run after any abort or error
function cleanupAfterCompletionOrAbort() {
    // **【关键修复】** 清除任何悬挂的 setTimeout 动画
    if (typingTimeoutId) {
        clearTimeout(typingTimeoutId); 
        typingTimeoutId = null;
    }
    typingIndicator.classList.remove("visible");
    sendButton.disabled = false;
    cancelButton.style.display = 'none';
    userInput.disabled = false;
    userInput.focus();
    isProcessing = false;
    abortController = null; // Clear controller
}

function loadCustomPrompt() {
  const savedPrompt = localStorage.getItem(CUSTOM_PROMPT_KEY);
  const customPromptEditor = document.getElementById('custom-prompt-editor'); // Ensure it's accessed here
  if (savedPrompt) {
    customPromptEditor.value = savedPrompt;
    customPromptEditor.style.height = "auto";
    customPromptEditor.style.height = customPromptEditor.scrollHeight + "px";
  } else {
    customPromptEditor.value = PRESET_PROMPTS['default'];
    customPromptEditor.style.height = "auto";
    customPromptEditor.style.height = customPromptEditor.scrollHeight + "px";
  }
}

function getSystemPrompt() {
  const promptPresetSelector = document.getElementById('prompt-preset'); // Ensure it's accessed here
  const customPromptEditor = document.getElementById('custom-prompt-editor'); // Ensure it's accessed here
  const selectedPreset = promptPresetSelector.value;
  if (selectedPreset === 'custom') {
    return customPromptEditor.value.trim();
  } else {
    return PRESET_PROMPTS[selectedPreset];
  }
}

function showPromptModal() {
  loadCustomPrompt(); 
  document.getElementById('prompt-modal-overlay').classList.add('visible'); // Ensure overlay is accessed
}

function hidePromptModal() {
  document.getElementById('prompt-modal-overlay').classList.remove('visible'); // Ensure overlay is accessed
}

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
  cancelButton.style.display = 'block';
  typingIndicator.classList.add("visible");

  appendMessage(message, 'user');
  const currentTurnMessages = [...conversationHistory, { role: 'user', content: message }];
  
  userInput.value = "";
  userInput.style.height = 'auto';

  abortController = new AbortController();
  const { signal } = abortController;

  try {
    const selectedModel = modelSelector.value;
    const systemPrompt = getSystemPrompt(); 

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        systemPrompt: systemPrompt,
        messages: currentTurnMessages,
      }),
      signal: signal,
    });

    if (!response.ok) { throw new Error(`API error: ${response.status} ${response.statusText}`); }

    typingIndicator.classList.remove("visible");
    cancelButton.style.display = 'none';
    
    const aiMessageWrapper = document.createElement("div");
    aiMessageWrapper.className = `message assistant-message`;
    const aiMessageParagraph = document.createElement("p");
    aiMessageWrapper.appendChild(aiMessageParagraph);
    chatMessages.appendChild(aiMessageWrapper);

    let aiResponseText = ""; 

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullBackendResponseChunk = "";

    while (true) {
        if (signal.aborted) { 
            console.log("Reading aborted by user.");
            reader.cancel(); 
            break; 
        }
        const { done, value } = await reader.read();
        if (done) break;
        fullBackendResponseChunk += decoder.decode(value, {stream: true});
    }

    const lines = fullBackendResponseChunk.split('\n');
    for (const line of lines) {
        if (line.startsWith("data: ")) {
            try {
                const dataStr = line.substring(5).trim();
                if (dataStr === '[DONE]') continue; 
                const jsonData = JSON.parse(dataStr);
                if (jsonData.response) {
                    aiResponseText += jsonData.response;
                }
            } catch (e) { console.error("Error parsing backend SSE:", e); }
        }
    }

    if (signal.aborted) { 
        console.log("Fetch request aborted, skipping typing animation and history update.");
        return; 
    }

    const finalRenderedText = aiResponseText;
    aiMessageParagraph.textContent = ''; 
    let charIndex = 0;
    const typingSpeed = 20; 

    const typeCharacter = () => {
        if (signal.aborted) { 
            console.log("Typing animation aborted.");
            aiMessageParagraph.innerHTML = DOMPurify.sanitize(marked.parse(finalRenderedText)); 
            cleanupAfterCompletionOrAbort();
            return; 
        }

        if (charIndex < finalRenderedText.length) {
            aiMessageParagraph.textContent += finalRenderedText.charAt(charIndex); 
            charIndex++;
            chatMessages.scrollTop = chatMessages.scrollHeight;
            typingTimeoutId = setTimeout(typeCharacter, typingSpeed); // Store timeout ID here
        } else {
            aiMessageParagraph.innerHTML = DOMPurify.sanitize(marked.parse(finalRenderedText));
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            conversationHistory.push({ role: 'user', content: message });
            conversationHistory.push({ role: 'assistant', content: finalRenderedText });
            
            cleanupAfterCompletionOrAbort(); 
        }
    };
    typeCharacter(); 

  } catch (error) {
    if (error.name === 'AbortError') {
        console.log("Fetch request successfully aborted.");
    } else {
        console.error("Error:", error);
        appendMessage(`Sorry, an error occurred: ${error.message}`, 'assistant');
    }
    cleanupAfterCompletionOrAbort(); 
  }
}

function appendMessage(text, role) {
  const messageWrapper = document.createElement("div");
  messageWrapper.className = `message ${role}-message`;
  const messageParagraph = document.createElement("p");
  messageParagraph.textContent = text;
  messageWrapper.appendChild(messageParagraph);
  chatMessages.appendChild(messageWrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return role === 'assistant' ? messageParagraph : messageWrapper;
}

// Initial setup on page load
loadCustomPrompt(); 
resetChat(); 