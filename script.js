/**
 * TASKORA + AEGIS - Frontend Logic
 * Strictly Vanilla JS, no external libraries.
 */

// --- CONFIGURATION ---
const BASE_URL = "https://taskora-backend-y86y.onrender.com";
// Production: const BASE_URL = "https://your-api.onrender.com";

const API = {
  AUTH: {
    ME: "/auth/me",
    LOGIN: "/auth/login",
    SIGNUP: "/auth/sign-up",
    REFRESH: "/auth/refresh",
    LOGOUT: "/auth/logout",
    DELETE_ACCOUNT: "/auth/delete-account",
  },
  TASKS: {
    CREATE: "/tasks/create",
    UPDATE: (id) => `/tasks/update/${id}`,
    UPDATE_STATUS: (id) => `/tasks/update-status/${id}`,
    LIST: "/tasks/view-tasks",
    DELETE: (id) => `/tasks/delete-task/${id}`,
    CHAT: "/tasks/chat",
  },
};

// --- STATE ---
const state = {
  user: null,
  tasks: [],
  aiBusy: false,
  activeTaskId: null,
  deleteTarget: null,
};

// --- DOM ELEMENTS ---
const views = {
  loader: document.getElementById("initial-loader"),
  auth: document.getElementById("auth-view"),
  greeting: document.getElementById("greeting-view"),
  dashboard: document.getElementById("dashboard-view"),
};

const forms = {
  login: document.getElementById("login-form"),
  signup: document.getElementById("signup-form"),
  createTask: document.getElementById("create-task-form"),
  editTask: document.getElementById("edit-task-form"),
  aegis: document.getElementById("aegis-form"),
};

const dom = {
  dashboardLayout: document.getElementById("dashboard-layout"),
  taskList: document.getElementById("task-list"),
  emptyState: document.getElementById("task-empty-state"),
  aegisHistory: document.getElementById("aegis-chat-history"),
  aegisThinking: document.getElementById("aegis-thinking"),
  aegisInput: document.getElementById("aegis-input"),
  btnAegisSend: document.getElementById("btn-send-aegis"),
  btnToggleAegis: document.getElementById("btn-toggle-aegis"),
  btnCloseAegis: document.getElementById("btn-close-aegis"),
  hotbar: document.getElementById("user-hotbar"),
  avatarBtn: document.getElementById("btn-user-avatar"),
  deleteModal: document.getElementById("delete-modal"),
  editModal: document.getElementById("edit-task-modal"),
};

// --- UTILITIES ---

async function apiFetch(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const defaultOptions = {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  };

  const mergedOptions = { ...defaultOptions, ...options };
  if (options.headers) {
    mergedOptions.headers = { ...defaultOptions.headers, ...options.headers };
  }

  try {
    const response = await fetch(url, mergedOptions);
    return response;
  } catch (error) {
    throw new Error("Network failure");
  }
}

// Parses FastAPI 422 validation arrays into clean strings
function parseApiError(data) {
  if (!data) return "An unknown error occurred.";
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) {
    return data.detail.map((err) => err.msg || "Validation Error").join(" | ");
  }
  return data.message || "An error occurred.";
}

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function switchView(viewName) {
  Object.values(views).forEach((v) => {
    if (v) v.classList.remove("active");
  });
  if (views[viewName]) views[viewName].classList.add("active");
}

function setButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(
    /[&<>'"]/g,
    (tag) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        tag
      ] || tag,
  );
}

// --- SESSION LOGIC ---

async function checkSession(isInitialLoad = true) {
  if (isInitialLoad) switchView("loader");

  try {
    const res = await apiFetch(API.AUTH.ME, { method: "GET" });

    if (res.ok) {
      const data = await res.json();
      state.user = data.username;
      if (isInitialLoad) {
        await initDashboard(state.user);
        switchView("dashboard");
      }
      return true;
    }

    if (res.status === 401) {
      const refreshRes = await apiFetch(API.AUTH.REFRESH, { method: "POST" });
      if (refreshRes.ok) {
        const retryRes = await apiFetch(API.AUTH.ME, { method: "GET" });
        if (retryRes.ok) {
          const data = await retryRes.json();
          state.user = data.username;
          if (isInitialLoad) {
            await initDashboard(state.user);
            switchView("dashboard");
          }
          return true;
        }
      }
    }

    if (isInitialLoad) switchView("auth");
    return false;
  } catch (err) {
    if (isInitialLoad) {
      showToast("Unable to connect to server.", "error");
      switchView("auth");
    }
    return false;
  }
}

// --- AUTH FLOWS ---

forms.login.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const btn = document.getElementById("btn-login");

  if (!email || !password) return;
  setButtonLoading(btn, true);

  let res;
  // 1. Strictly isolate the network request
  try {
    res = await apiFetch(API.AUTH.LOGIN, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    showToast("Unable to connect. Check your connection.", "error");
    setButtonLoading(btn, false);
    return; // Stop execution if actual network error
  }

  // 2. Handle the response safely outside the network try/catch
  if (res.ok) {
    let fetchedUser = "User";
    try {
      const userRes = await apiFetch(API.AUTH.ME, { method: "GET" });
      if (userRes.ok) {
        const userData = await userRes.json();
        fetchedUser = userData.username;
      }
    } catch (fetchErr) {
      console.error("Non-fatal error fetching profile:", fetchErr);
    }
    state.user = fetchedUser;

    // Trigger greeting sequence WITHOUT awaiting it here to prevent blocking
    playGreetingSequence(state.user, false).catch(console.error);
  } else if (res.status === 401) {
    showToast("Invalid email or password.", "error");
    setButtonLoading(btn, false);
  } else if (res.status === 404) {
    showToast("Account not found.", "error");
    setButtonLoading(btn, false);
  } else {
    try {
      const errorData = await res.json();
      showToast(parseApiError(errorData), "error");
    } catch (jsonErr) {
      showToast("Something went wrong. Please try again.", "error");
    }
    setButtonLoading(btn, false);
  }
});

forms.signup.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("signup-username").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const confirm = document.getElementById("signup-confirm").value;
  const btn = document.getElementById("btn-signup");

  if (password !== confirm) {
    showToast("Passwords do not match.", "error");
    return;
  }
  if (password.length < 8) {
    showToast("Password must be at least 8 characters.", "error");
    return;
  }

  setButtonLoading(btn, true);

  let res;
  // 1. Strictly isolate the network request
  try {
    res = await apiFetch(API.AUTH.SIGNUP, {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });
  } catch (err) {
    showToast("Unable to connect. Check your connection.", "error");
    setButtonLoading(btn, false);
    return;
  }

  // 2. Handle the response
  if (res.ok) {
    state.user = username;
    playGreetingSequence(state.user, true).catch(console.error);
  } else if (res.status === 409) {
    showToast("Email is already registered. Try logging in.", "error");
    toggleAuthForms("login");
    setButtonLoading(btn, false);
  } else {
    try {
      const errorData = await res.json();
      showToast(parseApiError(errorData), "error");
    } catch (jsonErr) {
      showToast("Signup failed. Please try again.", "error");
    }
    setButtonLoading(btn, false);
  }
});

async function playGreetingSequence(username, isNewUser = false) {
  try {
    views.auth.style.opacity = "0";
    setTimeout(() => switchView("greeting"), 500);

    const g2 = document.getElementById("greeting-2");
    const g3 = document.getElementById("greeting-3");

    if (isNewUser) {
      if (g2) g2.innerHTML = `hello, <span id="greeting-username"></span>!`;
      if (g3) g3.textContent = "Let's get productive";
    } else {
      if (g2)
        g2.innerHTML = `Welcome Back, <span id="greeting-username"></span>!`;
      if (g3) g3.textContent = "Back to building momentum";
    }

    const usernameSpan = document.getElementById("greeting-username");
    if (usernameSpan) usernameSpan.textContent = username;

    await delay(600);

    if (g2) {
      g2.classList.add("show");
      await delay(2500);
      g2.classList.remove("show");
    }
    if (g3) {
      g3.classList.add("show");
      await delay(2500);
      g3.classList.remove("show");
    }

    await initDashboard(username);
    switchView("dashboard");
    views.auth.style.opacity = "";

    // Safe resets
    if (forms.login) forms.login.reset();
    if (forms.signup) forms.signup.reset();
    resetPasswordStrength();
    setButtonLoading(document.getElementById("btn-login"), false);
    setButtonLoading(document.getElementById("btn-signup"), false);
  } catch (err) {
    console.error("Non-fatal animation error:", err);
    // Fallback: Skip animation and force them into dashboard safely
    await initDashboard(username);
    switchView("dashboard");
    views.auth.style.opacity = "";
    setButtonLoading(document.getElementById("btn-login"), false);
    setButtonLoading(document.getElementById("btn-signup"), false);
  }
}

// --- DASHBOARD INIT & TASKS ---

async function initDashboard(username) {
  try {
    const elUsername = document.getElementById("hotbar-username");
    const elAvatar = document.getElementById("avatar-initial");

    if (elUsername) elUsername.textContent = username;
    if (elAvatar && username)
      elAvatar.textContent = username.charAt(0).toUpperCase();

    await loadTasks();
  } catch (err) {
    console.error("Dashboard Init Error:", err);
  }
}

async function loadTasks() {
  try {
    const res = await apiFetch(API.TASKS.LIST, { method: "GET" });
    if (res.ok) {
      const tasks = await res.json();
      state.tasks = Array.isArray(tasks) ? tasks : [];
      renderTasks();
    } else if (res.status === 401) {
      showToast("Session expired. Please log in.", "error");
      switchView("auth");
    }
  } catch (e) {
    console.error("Tasks could not be loaded:", e);
  }
}

function renderTasks() {
  if (!dom.taskList || !dom.emptyState) return;

  dom.taskList.innerHTML = "";
  if (state.tasks.length === 0) {
    dom.emptyState.classList.remove("hidden");
    return;
  }
  dom.emptyState.classList.add("hidden");

  state.tasks.forEach((task) => {
    const isDone = task.completed || task.is_done;
    const priorityClass = task.priority
      ? `priority-${task.priority.toLowerCase()}`
      : "priority-low";

    const card = document.createElement("div");
    card.className = `task-card ${isDone ? "completed" : ""}`;
    card.dataset.id = task.id;

    card.innerHTML = `
            <div class="task-checkbox">
                <input type="checkbox" aria-label="Mark task complete" ${isDone ? "checked" : ""} onchange="toggleTaskStatus(${task.id}, this.checked)">
            </div>
            <div class="task-content">
                <div class="task-title-row">
                    <span class="task-title">${escapeHTML(task.title)}</span>
                    ${task.priority ? `<span class="priority-badge ${priorityClass}">${escapeHTML(task.priority)}</span>` : ""}
                </div>
                ${task.description ? `<p class="task-desc">${escapeHTML(task.description)}</p>` : ""}
                <div class="task-meta">
                    ${task.due_date ? `<div class="task-due"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${escapeHTML(task.due_date)}</div>` : ""}
                </div>
            </div>
            <div class="task-actions">
                <button class="btn-icon" aria-label="Edit task" onclick="openEditModal(${task.id})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="btn-icon" aria-label="Delete task" onclick="promptDeleteTask(${task.id})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;
    dom.taskList.appendChild(card);
  });
}

// --- TASK CRUD OPERATIONS ---

forms.createTask.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("new-task-desc");
  const desc = input.value.trim();
  if (!desc) return;

  input.value = "";

  try {
    const res = await apiFetch(API.TASKS.CREATE, {
      method: "POST",
      body: JSON.stringify({ description: desc }),
    });
    if (res.ok) {
      await loadTasks();
    } else {
      showToast("Failed to create task.", "error");
      input.value = desc;
    }
  } catch (e) {
    showToast("Network error. Could not create task.", "error");
    input.value = desc;
  }
});

window.toggleTaskStatus = async (id, isDone) => {
  try {
    const res = await apiFetch(
      `${API.TASKS.UPDATE_STATUS(id)}?is_done=${isDone}`,
      { method: "PATCH" },
    );
    if (res.ok) {
      await loadTasks();
    } else {
      showToast("Failed to update status.", "error");
      await loadTasks();
    }
  } catch (e) {
    showToast("Network error.", "error");
    await loadTasks();
  }
};

window.openEditModal = (id) => {
  state.activeTaskId = id;
  const task = state.tasks.find((t) => t.id === id);
  if (task) {
    document.getElementById("edit-task-desc").value =
      task.description || task.title;
    dom.editModal.classList.add("active");
  }
};

forms.editTask.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.activeTaskId) return;

  const desc = document.getElementById("edit-task-desc").value.trim();
  const btn = document.getElementById("btn-confirm-edit");
  setButtonLoading(btn, true);

  try {
    const res = await apiFetch(API.TASKS.UPDATE(state.activeTaskId), {
      method: "PATCH",
      body: JSON.stringify({ description: desc }),
    });
    if (res.ok) {
      dom.editModal.classList.remove("active");
      showToast("Task updated.", "success");
      await loadTasks();
    } else {
      showToast("Failed to update task.", "error");
    }
  } catch (e) {
    showToast("Network error.", "error");
  } finally {
    setButtonLoading(btn, false);
  }
});

document.getElementById("btn-cancel-edit").addEventListener("click", () => {
  dom.editModal.classList.remove("active");
  state.activeTaskId = null;
});

window.promptDeleteTask = (id) => {
  state.deleteTarget = "task";
  state.activeTaskId = id;
  document.getElementById("delete-modal-title").textContent =
    "Delete this task?";
  document.getElementById("delete-modal-desc").textContent =
    "This task will be permanently removed.";
  document.getElementById("delete-btn-text").textContent = "Delete task";
  dom.deleteModal.classList.add("active");
};

// --- AEGIS ASSISTANT LAYOUT TOGGLES & INTRO ---

async function playAegisIntro() {
  setAegisBusy(true);
  dom.aegisThinking.classList.remove("hidden");
  scrollToBottomAegis();

  await delay(1200);

  dom.aegisThinking.classList.add("hidden");
  appendAegisMessage(
    "Hello, I am AEGIS (Adaptive Engine for Guidance & Intelligent Scheduling) at your service.",
  );
  setAegisBusy(false);
}

function checkAndPlayAegisIntro() {
  if (dom.aegisHistory.children.length === 0) {
    playAegisIntro();
  }
}

function toggleAegisPanel(e) {
  if (e) e.preventDefault();
  dom.dashboardLayout.classList.toggle("aegis-active");

  if (dom.dashboardLayout.classList.contains("aegis-active")) {
    checkAndPlayAegisIntro();
    setTimeout(() => {
      if (dom.aegisInput) dom.aegisInput.focus();
    }, 500);
  }
}

function openAegisPanel(e) {
  if (e) e.preventDefault();
  dom.dashboardLayout.classList.add("aegis-active");

  checkAndPlayAegisIntro();
  setTimeout(() => {
    if (dom.aegisInput) dom.aegisInput.focus();
  }, 500);
}

if (dom.btnToggleAegis)
  dom.btnToggleAegis.addEventListener("click", toggleAegisPanel);
if (dom.btnCloseAegis)
  dom.btnCloseAegis.addEventListener("click", toggleAegisPanel);
const btnTalkAegis = document.getElementById("btn-empty-talk-aegis");
if (btnTalkAegis) btnTalkAegis.addEventListener("click", openAegisPanel);

// --- AEGIS ASSISTANT CHAT LOGIC ---

function resetAegisConversation() {
  dom.aegisHistory.classList.add("reset-exit");
  setTimeout(() => {
    dom.aegisHistory.innerHTML = "";
    dom.aegisHistory.classList.remove("reset-exit");
    playAegisIntro();
  }, 600);
}

forms.aegis.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.aiBusy) return;

  const message = dom.aegisInput.value.trim();
  if (!message) return;

  dom.aegisInput.value = "";
  dom.aegisInput.style.height = "auto";

  appendUserMessage(message);
  setAegisBusy(true);

  try {
    const res = await apiFetch(API.TASKS.CHAT, {
      method: "POST",
      body: JSON.stringify({ message: message }),
    });

    if (res.ok) {
      const data = await res.json();
      handleAegisResponse(data);
    } else {
      showToast("AEGIS couldn't complete that request.", "error");
    }
  } catch (e) {
    showToast("Unable to connect to AEGIS.", "error");
  } finally {
    setAegisBusy(false);
  }
});

dom.aegisInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

dom.aegisInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    forms.aegis.dispatchEvent(new Event("submit"));
  }
});

function appendUserMessage(text) {
  const wrapper = document.createElement("div");
  wrapper.className = "chat-message user";
  wrapper.innerHTML = `<div class="message-bubble">${escapeHTML(text)}</div>`;
  dom.aegisHistory.appendChild(wrapper);
  scrollToBottomAegis();
}

function appendAegisMessage(text) {
  const wrapper = document.createElement("div");
  wrapper.className = "chat-message ai";
  wrapper.innerHTML = `<div class="message-bubble">${escapeHTML(text)}</div>`;
  dom.aegisHistory.appendChild(wrapper);
  scrollToBottomAegis();
  return wrapper;
}

function handleAegisResponse(data) {
  if (data.message) {
    const aiBubble = appendAegisMessage(data.message);

    if (
      data.suggested_tasks &&
      Array.isArray(data.suggested_tasks) &&
      data.suggested_tasks.length > 0
    ) {
      const suggestionsContainer = document.createElement("div");
      suggestionsContainer.className = "ai-suggested-tasks";

      data.suggested_tasks.forEach((task) => {
        const priorityClass = task.priority
          ? `priority-${task.priority.toLowerCase()}`
          : "priority-low";
        suggestionsContainer.innerHTML += `
                    <div class="task-card">
                        <div class="task-content">
                            <div class="task-title-row">
                                <span class="task-title">${escapeHTML(task.title || task.description)}</span>
                                ${task.priority ? `<span class="priority-badge ${priorityClass}">${escapeHTML(task.priority)}</span>` : ""}
                            </div>
                            ${task.due_date ? `<div class="task-meta"><div class="task-due"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${escapeHTML(task.due_date)}</div></div>` : ""}
                        </div>
                    </div>
                `;
      });

      if (data.requires_confirmation) {
        suggestionsContainer.innerHTML += `
                    <div class="ai-action-row">
                        <button type="button" class="btn-secondary" onclick="aegisConfirmSuggestions()">Create these tasks</button>
                        <button type="button" class="btn-secondary subtle-btn" onclick="aegisRejectSuggestions()">Not now</button>
                    </div>
                `;
      }
      aiBubble.appendChild(suggestionsContainer);
      scrollToBottomAegis();
    }
  }

  if (data.tasks || data.task || data.conversation_complete) {
    loadTasks();
  }

  if (data.conversation_complete === true) {
    setAegisBusy(true);
    setTimeout(() => {
      resetAegisConversation();
      setAegisBusy(false);
    }, 2000);
  }
}

window.aegisConfirmSuggestions = () => {
  dom.aegisInput.value = "yes";
  forms.aegis.dispatchEvent(new Event("submit"));
};

window.aegisRejectSuggestions = () => {
  resetAegisConversation();
};

function setAegisBusy(isBusy) {
  state.aiBusy = isBusy;
  dom.btnAegisSend.disabled = isBusy;
  dom.aegisInput.disabled = isBusy;

  if (isBusy) {
    dom.aegisThinking.classList.remove("hidden");
    scrollToBottomAegis();
  } else {
    dom.aegisThinking.classList.add("hidden");
  }
}

function scrollToBottomAegis() {
  dom.aegisHistory.scrollTop = dom.aegisHistory.scrollHeight;
}

// --- USER MENU & DELETE LOGIC ---

if (dom.avatarBtn) {
  dom.avatarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dom.hotbar.classList.toggle("active");
  });
}
document.addEventListener("click", (e) => {
  if (
    dom.hotbar &&
    !dom.hotbar.contains(e.target) &&
    e.target !== dom.avatarBtn
  ) {
    dom.hotbar.classList.remove("active");
  }
});

const btnLogout = document.getElementById("btn-logout");
if (btnLogout) {
  btnLogout.addEventListener("click", async () => {
    try {
      await apiFetch(API.AUTH.LOGOUT, { method: "POST" });
    } catch (e) {}
    state.user = null;
    dom.hotbar.classList.remove("active");
    switchView("auth");
    showToast("You've been logged out.", "success");
  });
}

const btnDeletePrompt = document.getElementById("btn-delete-prompt");
if (btnDeletePrompt) {
  btnDeletePrompt.addEventListener("click", () => {
    dom.hotbar.classList.remove("active");
    state.deleteTarget = "account";
    document.getElementById("delete-modal-title").textContent =
      "Delete your account?";
    document.getElementById("delete-modal-desc").textContent =
      "This permanently removes your account and its associated data. This action cannot be undone.";
    document.getElementById("delete-btn-text").textContent = "Delete Account";
    dom.deleteModal.classList.add("active");
  });
}

const btnCancelDelete = document.getElementById("btn-cancel-delete");
if (btnCancelDelete) {
  btnCancelDelete.addEventListener("click", () => {
    dom.deleteModal.classList.remove("active");
    state.deleteTarget = null;
    state.activeTaskId = null;
  });
}

const btnConfirmDelete = document.getElementById("btn-confirm-delete");
if (btnConfirmDelete) {
  btnConfirmDelete.addEventListener("click", async () => {
    setButtonLoading(btnConfirmDelete, true);

    try {
      if (state.deleteTarget === "account") {
        const res = await apiFetch(API.AUTH.DELETE_ACCOUNT, {
          method: "DELETE",
        });
        if (res.ok) {
          state.user = null;
          dom.deleteModal.classList.remove("active");
          switchView("auth");
          showToast("Your account has been deleted.", "success");
        } else {
          showToast("Failed to delete account.", "error");
        }
      } else if (state.deleteTarget === "task") {
        const res = await apiFetch(API.TASKS.DELETE(state.activeTaskId), {
          method: "DELETE",
        });
        if (res.ok) {
          dom.deleteModal.classList.remove("active");
          showToast("Task deleted.", "success");
          await loadTasks();
        } else {
          showToast("Failed to delete task.", "error");
        }
      }
    } catch (err) {
      showToast("Network error. Try again later.", "error");
    } finally {
      setButtonLoading(btnConfirmDelete, false);
      state.deleteTarget = null;
      state.activeTaskId = null;
    }
  });
}

// --- AUTH UI INTERACTIONS ---

const linkToSignup = document.getElementById("link-to-signup");
if (linkToSignup) {
  linkToSignup.addEventListener("click", (e) => {
    e.preventDefault();
    toggleAuthForms("signup");
  });
}

const linkToLogin = document.getElementById("link-to-login");
if (linkToLogin) {
  linkToLogin.addEventListener("click", (e) => {
    e.preventDefault();
    toggleAuthForms("login");
  });
}

function toggleAuthForms(target) {
  if (target === "signup") {
    forms.login.classList.remove("active");
    setTimeout(() => forms.signup.classList.add("active"), 50);
  } else {
    forms.signup.classList.remove("active");
    setTimeout(() => forms.login.classList.add("active"), 50);
  }
}

document.querySelectorAll(".toggle-password").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const input = e.currentTarget.parentElement.querySelector("input");
    if (!input) return;
    const type =
      input.getAttribute("type") === "password" ? "text" : "password";
    input.setAttribute("type", type);
    e.currentTarget.style.opacity = type === "text" ? "0.5" : "1";
  });
});

const signupPassword = document.getElementById("signup-password");
const strengthContainer = document.getElementById(
  "password-strength-container",
);
const strengthLabel = document.getElementById("strength-label");
const strengthBars = document.querySelectorAll(".strength-bars .bar");
const reqElements = {
  length: document.getElementById("req-length"),
  upper: document.getElementById("req-upper"),
  lower: document.getElementById("req-lower"),
  num: document.getElementById("req-num"),
  spec: document.getElementById("req-spec"),
};

if (signupPassword) {
  signupPassword.addEventListener("input", (e) => {
    const val = e.target.value;
    if (val.length > 0) {
      strengthContainer.style.display = "block";
    } else {
      strengthContainer.style.display = "none";
      resetPasswordStrength();
      return;
    }

    const rules = {
      length: val.length >= 8,
      upper: /[A-Z]/.test(val),
      lower: /[a-z]/.test(val),
      num: /[0-9]/.test(val),
      spec: /[^A-Za-z0-9]/.test(val),
    };

    Object.keys(rules).forEach((key) => {
      if (rules[key]) reqElements[key].classList.add("met");
      else reqElements[key].classList.remove("met");
    });
    updateStrengthVisuals(Object.values(rules).filter(Boolean).length);
  });
}

function updateStrengthVisuals(score) {
  strengthBars.forEach((bar) => {
    bar.style.background = "var(--input-border)";
    bar.style.boxShadow = "none";
  });
  let color = "",
    label = "",
    filledBars = 0;

  if (score <= 2) {
    color = "var(--accent-destructive)";
    label = "Weak";
    filledBars = 1;
  } else if (score === 3) {
    color = "#f59e0b";
    label = "Fair";
    filledBars = 2;
  } else if (score === 4) {
    color = "var(--accent-cyan)";
    label = "Good";
    filledBars = 3;
  } else if (score === 5) {
    color = "var(--accent-teal)";
    label = "Strong";
    filledBars = 4;
  }

  if (strengthLabel) {
    strengthLabel.textContent = label;
    strengthLabel.style.color = color;
  }
  for (let i = 0; i < filledBars; i++) {
    if (strengthBars[i]) {
      strengthBars[i].style.background = color;
      strengthBars[i].style.boxShadow = `0 0 8px ${color}`;
    }
  }
}

function resetPasswordStrength() {
  if (strengthContainer) strengthContainer.style.display = "none";
  Object.values(reqElements).forEach((el) => {
    if (el) el.classList.remove("met");
  });
  updateStrengthVisuals(0);
}

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  checkSession(true);
});
