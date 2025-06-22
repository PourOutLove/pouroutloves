/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chatMessages");
const userInput = document.getElementById("userInput");
const sendButton = document.getElementById("sendButton");
const typingIndicator = document.getElementById("typingIndicator");

// Chat state
let chatHistory = [
  {
    role: "assistant",
    content:
      "Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
  },
];
let isProcessing = false;

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

/**
 * Sends a message to the chat API and processes the response
 * @param {string} [retryMessage] - Message to retry, if applicable
 * @param {HTMLElement} [messageWrapper] - Wrapper element to replace, if retrying
 */
async function sendMessage(retryMessage = null, messageWrapper = null) {
  const message = retryMessage || userInput.value.trim();

  // Don't send empty messages
  if (message === "" || isProcessing) return;

  // Disable input while processing
  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  // Add user message to chat (unless retrying)
  let userMessageEl = null;
  if (!retryMessage) {
    userMessageEl = addMessageToChat("user", message);
    userInput.value = "";
    userInput.style.height = "auto";
  }

  // Show typing indicator
  typingIndicator.classList.add("visible");

  // Add message to history (unless retrying, where it's already in history)
  if (!retryMessage) {
    chatHistory.push({ role: "user", content: message });
  }

  try {
    // Create wrapper for assistant message and actions
    const messageWrapperEl = document.createElement("div");
    messageWrapperEl.className = "message-wrapper";

    // Create assistant message element
    const assistantMessageEl = document.createElement("div");
    assistantMessageEl.className = "message assistant-message";
    const pElement = document.createElement("p");
    assistantMessageEl.appendChild(pElement);

    // Create actions element
    const actionsEl = document.createElement("div");
    actionsEl.className = "message-actions";
    actionsEl.innerHTML = `
      <span class="message-action like" data-liked="false"><i data-feather="heart"></i> Like</span>
      <span class="message-action retry"><i data-feather="refresh-cw"></i> Retry</span>
      <span class="message-action copy"><i data-feather="copy"></i> Copy</span>
    `;

    // Append message and actions to wrapper
    messageWrapperEl.appendChild(assistantMessageEl);
    messageWrapperEl.appendChild(actionsEl);

    // Replace previous wrapper if retrying
    if (messageWrapper) {
      messageWrapper.replaceWith(messageWrapperEl);
    } else {
      chatMessages.appendChild(messageWrapperEl);
    }

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Initialize Feather Icons for actions
    feather.replace();

    // Add event listeners for actions
    const likeButton = actionsEl.querySelector(".like");
    likeButton.addEventListener("click", () => {
      const isLiked = likeButton.dataset.liked === "true";
      likeButton.dataset.liked = !isLiked;
      likeButton.classList.toggle("liked");
      const icon = likeButton.querySelector("i");
      icon.setAttribute("data-feather", "heart");
      if (!isLiked) {
        icon.setAttribute("fill", "currentColor");
      } else {
        icon.removeAttribute("fill");
      }
      feather.replace();
    });

    const retryButton = actionsEl.querySelector(".retry");
    retryButton.addEventListener("click", () => {
      // Find the previous user message
      let prevEl = messageWrapperEl.previousElementSibling;
      while (prevEl && !prevEl.classList.contains("message-wrapper")) {
        prevEl = prevEl.previousElementSibling;
      }
      if (prevEl) {
        const prevUserMessageEl = prevEl.querySelector(".user-message");
        if (prevUserMessageEl) {
          const prevMessage = prevUserMessageEl.querySelector("p").textContent;
          // Remove the current assistant message from history
          chatHistory.pop();
          sendMessage(prevMessage, messageWrapperEl);
        }
      }
    });

    const copyButton = actionsEl.querySelector(".copy");
    copyButton.addEventListener("click", () => {
      navigator.clipboard.writeText(pElement.textContent).then(() => {
        copyButton.innerHTML = '<i data-feather="check"></i> Copied';
        feather.replace();
        setTimeout(() => {
          copyButton.innerHTML = '<i data-feather="copy"></i> Copy';
          feather.replace();
        }, 2000);
      });
    });

    // Send request to API
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: chatHistory,
      }),
    });

    // Handle errors
    if (!response.ok) {
      throw new Error("Failed to get response");
    }

    // Process streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let responseText = "";
    let words = [];
    let currentWordIndex = 0;

    function animateWords() {
      if (currentWordIndex < words.length) {
        const span = document.createElement("span");
        span.className = "word-typing";
        span.textContent = words[currentWordIndex] + " ";
        pElement.appendChild(span);

        // Trigger animation
        setTimeout(() => {
          span.classList.add("visible");
        }, 10);

        currentWordIndex++;
        setTimeout(animateWords, 100); // 0.1s per word
      }
    }

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Decode chunk
      const chunk = decoder.decode(value, { stream: true });

      // Process SSE format
      const lines = chunk.split("\n");
      for (const line of lines) {
        try {
          const jsonData = JSON.parse(line);
          if (jsonData.response) {
            // Append new content to existing text
            responseText += jsonData.response;
            words = responseText.trim().split(/\s+/);
            pElement.style.setProperty('--word-count', words.length);

            // Start or continue word animation
            animateWords();

            // Scroll to bottom
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        } catch (e) {
          console.error("Error parsing JSON:", e);
        }
      }
    }

    // Add completed response to chat history
    chatHistory.push({ role: "assistant", content: responseText });
  } catch (error) {
    console.error("Error:", error);
    addMessageToChat("assistant", "Sorry, there was an error processing your request.");
  } finally {
    // Hide typing indicator
    typingIndicator.classList.remove("visible");

    // Re-enable input
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

/**
 * Helper function to add message to chat
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @returns {HTMLElement} - The created message element
 */
function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  if (role === "user") {
    messageEl.className = "message user-message";
    messageEl.innerHTML = `
      <span class="edit-icon" title="Edit"><i data-feather="edit-2"></i></span>
      <p>${content}</p>
    `;
    // Initialize Feather Icons
    feather.replace();
    // Add edit functionality
    const editIcon = messageEl.querySelector(".edit-icon");
    editIcon.addEventListener("click", () => {
      const p = messageEl.querySelector("p");
      const originalText = p.textContent;
      const textarea = document.createElement("textarea");
      textarea.className = "edit-textarea";
      textarea.value = originalText;
      textarea.rows = 2;
      messageEl.replaceChild(textarea, p);
      textarea.focus();

      const saveEdit = () => {
        const newText = textarea.value.trim();
        if (newText && newText !== originalText) {
          const newP = document.createElement("p");
          newP.textContent = newText;
          messageEl.replaceChild(newP, textarea);
          // Update chat history
          const index = Array.from(chatMessages.children).indexOf(messageEl);
          if (index >= 0 && chatHistory[index]) {
            chatHistory[index].content = newText;
          }
        } else {
          const newP = document.createElement("p");
          newP.textContent = originalText;
          messageEl.replaceChild(newP, textarea);
        }
      };

      textarea.addEventListener("blur", saveEdit);
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          saveEdit();
        }
      });
    });
  } else {
    const messageWrapperEl = document.createElement("div");
    messageWrapperEl.className = "message-wrapper";
    messageEl.className = "message assistant-message";
    messageEl.innerHTML = `<p>${content}</p>`;
    messageWrapperEl.appendChild(messageEl);
    chatMessages.appendChild(messageWrapperEl);
    return messageWrapperEl; // Return wrapper for consistency
  }
  chatMessages.appendChild(messageEl);

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return messageEl;
}
