(() => {
  const tokenKey = "personal-ai-os.dev-token";
  const conversationKey = "personal-ai-os.conversation-id";
  const transcriptKey = "personal-ai-os.session-transcript";

  const tokenInput = document.querySelector("#dev-token");
  const conversation = document.querySelector("#conversation");
  const errorBox = document.querySelector("#error");
  const form = document.querySelector("#message-form");
  const input = document.querySelector("#message-input");
  const sendButton = document.querySelector("#send-button");
  const refreshButton = document.querySelector("#refresh-button");
  const saveToken = document.querySelector("#save-token");
  const todayGrid = document.querySelector("#today-grid");
  const contextStatus = document.querySelector("#context-status");

  tokenInput.value = localStorage.getItem(tokenKey) || tokenInput.value || "dev-user";
  let conversationId = localStorage.getItem(conversationKey);
  if (!conversationId) {
    conversationId = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(conversationKey, conversationId);
  }

  const readTranscript = () => {
    try {
      return JSON.parse(sessionStorage.getItem(transcriptKey) || "[]");
    } catch (_error) {
      return [];
    }
  };

  const transcript = readTranscript();

  function newRequestId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function saveTranscript() {
    sessionStorage.setItem(transcriptKey, JSON.stringify(transcript.slice(-40)));
  }

  function addMessage(role, text, persist = true) {
    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    bubble.textContent = text;
    conversation.appendChild(bubble);
    conversation.scrollTop = conversation.scrollHeight;
    if (persist) {
      transcript.push({ role, text });
      saveTranscript();
    }
    return bubble;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.hidden = true;
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${tokenInput.value.trim()}`,
      "Content-Type": "application/json",
    };
  }

  function formatMoney(minor, currency) {
    if (minor === null || minor === undefined) return "—";
    return `${(Number(minor) / 100).toLocaleString("ar-EG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency || ""}`.trim();
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
  }

  function listCard(title, items, renderItem) {
    const card = document.createElement("article");
    card.className = "context-card";
    const heading = document.createElement("h3");
    heading.textContent = title;
    card.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "لا توجد بيانات محفوظة بعد.";
      card.appendChild(empty);
      return card;
    }
    const list = document.createElement("ul");
    list.className = "context-list";
    items.forEach((item) => {
      const row = document.createElement("li");
      renderItem(row, item);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  function textRow(row, text, detail = "") {
    const label = document.createElement("span");
    label.textContent = text;
    row.appendChild(label);
    if (detail) {
      const value = document.createElement("strong");
      value.textContent = detail;
      row.appendChild(value);
    }
  }

  function renderContext(data) {
    todayGrid.replaceChildren();
    todayGrid.appendChild(
      listCard("التذكيرات القادمة", data.upcoming_reminders || [], (row, item) => {
        textRow(row, item.text, formatDate(item.due_at));
      }),
    );
    todayGrid.appendChild(
      listCard("آخر المصروفات", data.recent_expenses || [], (row, item) => {
        const label = [item.description, item.person_name, item.project_name]
          .filter(Boolean)
          .join(" · ");
        textRow(row, label || "مصروف", formatMoney(item.amount_minor, item.currency));
      }),
    );
    todayGrid.appendChild(
      listCard("المشروعات النشطة", data.active_projects || [], (row, item) => {
        textRow(row, item.name);
      }),
    );
    todayGrid.appendChild(
      listCard("الأشخاص", data.relevant_people || [], (row, item) => {
        textRow(row, item.name);
      }),
    );
    todayGrid.appendChild(
      listCard("المهام المعلقة", data.pending_tasks || [], (row, item) => {
        textRow(row, item.title, item.due_at ? formatDate(item.due_at) : "");
      }),
    );
  }

  async function loadContext() {
    contextStatus.textContent = "جارٍ التحميل…";
    try {
      const response = await fetch("/v1/today", { headers: authHeaders() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "تعذر تحميل السياق المحفوظ.");
      renderContext(body.context);
      contextStatus.textContent = "محدّث الآن";
    } catch (error) {
      contextStatus.textContent = "تعذر التحديث";
      showError(error.message || "تعذر تحميل البيانات.");
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || sendButton.disabled) return;
    localStorage.setItem(tokenKey, tokenInput.value.trim());
    clearError();
    addMessage("user", message);
    input.value = "";
    input.style.height = "auto";
    sendButton.disabled = true;
    const loading = addMessage("assistant loading", "جارٍ التنفيذ…", false);
    try {
      const response = await fetch("/v1/turns", {
        method: "POST",
        headers: { ...authHeaders(), "Idempotency-Key": newRequestId() },
        body: JSON.stringify({ message, conversation_id: conversationId }),
      });
      const body = await response.json();
      loading.remove();
      if (!response.ok) throw new Error(body.error?.message || "تعذر تنفيذ الطلب.");
      addMessage("assistant", body.assistant_message || "تم.");
      await loadContext();
    } catch (error) {
      loading.remove();
      showError(error.message || "تعذر الاتصال بالخادم.");
      addMessage("assistant", "تعذر تنفيذ الطلب. راجع الرسالة الحمراء وحاول مرة أخرى.");
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  }

  saveToken.addEventListener("click", () => {
    localStorage.setItem(tokenKey, tokenInput.value.trim());
    clearError();
    loadContext();
  });
  refreshButton.addEventListener("click", loadContext);
  form.addEventListener("submit", sendMessage);
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  if (transcript.length) {
    transcript.forEach((item) => addMessage(item.role, item.text, false));
  } else {
    addMessage("assistant", "أهلاً. اكتب مصروفاً أو تذكيراً أو اسألني عن بياناتك.", false);
  }
  loadContext();
})();