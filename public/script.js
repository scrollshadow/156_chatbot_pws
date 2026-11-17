// ── State ──
let sessions = JSON.parse(localStorage.getItem('chat_sessions') || '[]');
let activeId = null;

// ── DOM ──
const sidebar       = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarOpenBtn= document.getElementById('sidebarOpenBtn');
const newChatBtn    = document.getElementById('newChatBtn');
const chatHistory   = document.getElementById('chatHistory');
const messagesEl    = document.getElementById('messages');
const emptyState    = document.getElementById('emptyState');
const userInput     = document.getElementById('userInput');
const sendBtn       = document.getElementById('sendBtn');

// ── Sidebar toggle ──
let sidebarOpen = true;
function setSidebar(open) {
  sidebarOpen = open;
  sidebar.classList.toggle('collapsed', !open);
  sidebarOpenBtn.classList.toggle('hidden', open);
}
sidebarToggle.addEventListener('click', () => setSidebar(false));
sidebarOpenBtn.addEventListener('click', () => setSidebar(true));

// ── Sessions ──
function saveSession(session) {
  const idx = sessions.findIndex(s => s.id === session.id);
  if (idx === -1) sessions.unshift(session);
  else sessions[idx] = session;
  localStorage.setItem('chat_sessions', JSON.stringify(sessions));
}

function newSession() {
  const session = { id: Date.now().toString(), title: 'Chat baru', messages: [] };
  sessions.unshift(session);
  localStorage.setItem('chat_sessions', JSON.stringify(sessions));
  loadSession(session.id);
  renderHistory();
}

function loadSession(id) {
  activeId = id;
  const session = sessions.find(s => s.id === id);
  messagesEl.innerHTML = '';
  if (session && session.messages.length) {
    emptyState.classList.add('hidden');
    session.messages.forEach(m => appendMessage(m.role, m.content, false));
  } else {
    emptyState.classList.remove('hidden');
  }
  renderHistory();
  scrollBottom();
}

function renderHistory() {
  chatHistory.innerHTML = '';
  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = 'history-item' + (s.id === activeId ? ' active' : '');
    item.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>${escHtml(s.title)}</span>`;
    item.addEventListener('click', () => loadSession(s.id));
    chatHistory.appendChild(item);
  });
}

// ── Render message ──
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatText(raw) {
  // Extract code blocks first, replace with placeholders
  const codeBlocks = [];
  let text = raw.replace(/```([\s\S]*?)```/g, (_, c) => {
    codeBlocks.push(`<pre><code>${escHtml(c.trim())}</code></pre>`);
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
  });

  // Escape HTML in remaining text
  text = escHtml(text);

  // Apply inline markdown
  text = text
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`) // already escaped above
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  // Restore code blocks
  text = text.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, i) => codeBlocks[+i]);

  return text;
}

function appendMessage(role, content, withCursor = false) {
  emptyState.classList.add('hidden');
  const row = document.createElement('div');
  row.className = `msg ${role}`;

  const avatarText = role === 'user' ? 'U' : 'AI';
  row.innerHTML = `
    <div class="msg-avatar">${avatarText}</div>
    <div class="msg-content">
      <div class="msg-name">${role === 'user' ? 'You' : 'Assistant'}</div>
      <div class="msg-text">${formatText(content)}${withCursor ? '<span class="cursor"></span>' : ''}</div>
    </div>`;

  messagesEl.appendChild(row);
  scrollBottom();
  return row.querySelector('.msg-text');
}

function scrollBottom() {
  const wrapper = document.getElementById('messagesWrapper');
  wrapper.scrollTop = wrapper.scrollHeight;
}

// ── Send ──
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || sendBtn.disabled) return;

  if (!activeId) newSession();

  const session = sessions.find(s => s.id === activeId);
  session.messages.push({ role: 'user', content: text });
  if (session.title === 'Chat baru') {
    session.title = text.slice(0, 40) + (text.length > 40 ? '…' : '');
  }
  saveSession(session);
  renderHistory();

  appendMessage('user', text, false);
  userInput.value = '';
  autoResize();
  sendBtn.disabled = true;

  // bot placeholder
  const botTextEl = appendMessage('assistant', '', true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: session.messages })
    });

    if (!res.ok) {
      const err = await res.json();
      botTextEl.innerHTML = `<em style="color:#e55">Error: ${escHtml(err.error || 'Gagal')}</em>`;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data);
          fullText += chunk;
          botTextEl.innerHTML = formatText(fullText) + '<span class="cursor"></span>';
          scrollBottom();
        } catch {}
      }
    }

    // remove cursor
    botTextEl.innerHTML = formatText(fullText);
    session.messages.push({ role: 'assistant', content: fullText });
    saveSession(session);

  } catch (err) {
    botTextEl.innerHTML = `<em style="color:#e55">Koneksi gagal.</em>`;
  } finally {
    sendBtn.disabled = userInput.value.trim() === '';
    userInput.focus();
  }
}

// ── Input auto-resize ──
function autoResize() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
}

userInput.addEventListener('input', () => {
  autoResize();
  sendBtn.disabled = userInput.value.trim() === '';
});

userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);
newChatBtn.addEventListener('click', newSession);

// ── Init ──
renderHistory();
if (sessions.length) loadSession(sessions[0].id);
else newSession();
