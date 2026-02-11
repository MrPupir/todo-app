let currentUser = null;
let authToken = null;
let currentBoardId = null;
let boardData = { columns: [], tasks: [], history: [], members: [], myRole: 'comment', users: {} };
let currentOpenTaskId = null;
let currentReplyTo = null;
let ws;
let isRegisterMode = false;
let isCheckingSession = false;
let isLoggingIn = false;

const escape = (str) => str ? str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]) : '';

async function api(url, method = 'GET', body = null, isMultipart = false) {
    const headers = {};
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    if (!isMultipart) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) opts.body = isMultipart ? body : JSON.stringify(body);

    try {
        const res = await fetch(url, opts);
        if (res.status === 401) {
            if (url.includes('/auth/check')) return { success: false };
            if (url.includes('/auth/login') || url.includes('/auth/register')) {
                const data = await res.json().catch(() => ({ success: false, error: 'Authentication failed' }));
                return data;
            }
            if (!isLoggingIn) {
                logout();
            }
            return { error: 'Session expired' };
        }
        if (res.status === 403) return { error: 'Access Denied' };
        return await res.json();
    } catch (error) {
        console.error('API call failed:', error);
        return { error: 'Network error' };
    }
}

function connectWs() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host);
    ws.onopen = () => {
        if (authToken) ws.send(JSON.stringify({ type: 'AUTH', token: authToken }));
        if (currentBoardId) ws.send(JSON.stringify({ type: 'JOIN_BOARD', boardId: currentBoardId }));
    };
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'UPDATE') {
            if (msg.deletedTaskId && currentOpenTaskId === msg.deletedTaskId) closeModal('edit-modal');
            if (currentBoardId) loadBoardData(currentBoardId);
        }
        if (msg.type === 'PRESENCE') updateActiveUsers(msg.users);
        if (msg.type === 'BOARD_ADDED') loadBoards();
        if (msg.type === 'MEMBER_UPDATED') {
            if (currentBoardId) loadBoardData(currentBoardId);
        }
        if (msg.type === 'KICKED') {
            if (currentBoardId === msg.boardId) {
                showToast('You have been removed from this board', 'error');
                navigateToDashboard();
            } else loadBoards();
        }
        if (msg.type === 'BOARD_DELETED') {
            if (currentBoardId === msg.boardId) {
                showToast('Board deleted', 'error');
                navigateToDashboard();
            } else loadBoards();
        }
        if (msg.type === 'AUTH_OK') {
            console.log('WS authenticated');
        }
    };
    ws.onclose = () => setTimeout(connectWs, 3000);
}

window.addEventListener('popstate', handleRouting);
window.addEventListener('load', () => {
    checkSession();

    const commentInput = document.getElementById('new-comment');
    if (commentInput) {
        commentInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment(); }
        });
    }
});

connectWs();

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-title').innerText = isRegisterMode ? 'Sign Up' : 'Login';
    document.getElementById('auth-submit').innerText = isRegisterMode ? 'Sign Up' : 'Login';
    document.getElementById('auth-switch-text').innerText = isRegisterMode ? 'Already have an account? Login' : 'Don\'t have an account? Sign Up';
    document.getElementById('register-pass-confirm').style.display = isRegisterMode ? 'block' : 'none';
    document.getElementById('register-fields').style.display = isRegisterMode ? 'flex' : 'none';
}

function previewAvatar(input, imgId) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById(imgId);
            img.src = e.target.result;
            img.style.display = 'block';
        }
        reader.readAsDataURL(input.files[0]);
    }
}

async function performAuth() {
    const u = document.getElementById('auth-username').value;
    const p = document.getElementById('auth-password').value;

    if (!u || !p) return showToast('Fill all fields', 'error');
    const userRegex = /^[a-zA-Z0-9]+$/;
    if (!userRegex.test(u)) return showToast('Username: only letters and numbers', 'error');

    isLoggingIn = true;
    try {
        if (isRegisterMode) {
            const c = document.getElementById('auth-confirm').value;
            const dName = document.getElementById('reg-displayname').value;
            if (p !== c) {
                isLoggingIn = false;
                return showToast('Passwords do not match', 'error');
            }

            const formData = new FormData();
            formData.append('username', u);
            formData.append('password', p);
            formData.append('displayName', dName || u);
            const file = document.getElementById('reg-avatar').files[0];
            if (file) formData.append('avatar', file);

            const res = await api('/api/auth/register', 'POST', formData, true);
            if (res.success) {
                setSession(res);
            } else {
                showToast(res.error, 'error');
                isLoggingIn = false;
            }
        } else {
            const res = await api('/api/auth/login', 'POST', { username: u, password: p });
            if (res.success) {
                setSession(res);
            } else {
                showToast(res.error, 'error');
                isLoggingIn = false;
            }
        }
    } catch (error) {
        isLoggingIn = false;
        showToast('Login failed', 'error');
    }
}

function setSession(res) {
    authToken = res.token;
    currentUser = res.user;
    localStorage.setItem('authToken', authToken);
    isLoggingIn = false;
    closeModal('auth-modal');
    postLoginInit();
}

async function checkSession() {
    if (isCheckingSession) return;
    isCheckingSession = true;
    
    authToken = localStorage.getItem('authToken');
    if (!authToken) {
        isCheckingSession = false;
        openModal('auth-modal');
        return;
    }
    const res = await api('/api/auth/check', 'POST', { token: authToken });
    if (res.success) {
        currentUser = { username: res.username, displayName: res.displayName, avatar: res.avatar };
        closeModal('auth-modal');
        postLoginInit();
    } else {
        localStorage.removeItem('authToken');
        authToken = null;
        openModal('auth-modal');
    }
    isCheckingSession = false;
}

function postLoginInit() {
    updateUserHeader();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'AUTH', token: authToken }));
    }
    setTimeout(() => handleRouting(), 50);
}

function updateUserHeader() {
    document.getElementById('u-name').innerText = currentUser.displayName;
    document.getElementById('u-avatar-header').innerHTML = renderUserAvatar(currentUser, 30);
    document.getElementById('user-display').style.display = 'flex';
}

function openSettingsModal() {
    document.getElementById('settings-displayname').value = currentUser.displayName;
    refreshSettingsAvatar();
    openModal('settings-modal');
}

function refreshSettingsAvatar() {
    const img = document.getElementById('settings-avatar-img');
    const ini = document.getElementById('settings-avatar-initials');
    if (currentUser.avatar) {
        img.src = currentUser.avatar;
        img.style.display = 'block';
        ini.style.display = 'none';
    } else {
        img.style.display = 'none';
        ini.style.display = 'flex';
        ini.innerText = currentUser.displayName.substring(0, 2).toUpperCase();
    }
}

async function updateAvatar(input) {
    if (input.files && input.files[0]) {
        if (input.files[0].size > 10 * 1024 * 1024) {
            return showToast('File size must be under 10MB', 'error');
        }
        const formData = new FormData();
        formData.append('avatar', input.files[0]);
        const res = await api('/api/users/avatar', 'PUT', formData, true);
        if (res.success) {
            currentUser.avatar = res.avatar;
            refreshSettingsAvatar();
            updateUserHeader();
        }
    }
}

async function deleteAvatar() {
    if (!currentUser.avatar) return;
    const res = await api('/api/users/avatar', 'DELETE');
    if (res.success) {
        currentUser.avatar = null;
        refreshSettingsAvatar();
        updateUserHeader();
    }
}

async function updateProfileName() {
    const name = document.getElementById('settings-displayname').value;
    if (!name) return;
    const res = await api('/api/users/profile', 'PUT', { displayName: name });
    if (res.success) {
        currentUser.displayName = name;
        refreshSettingsAvatar();
        updateUserHeader();
        showToast('Profile updated');
    }
}

function handleRouting() {
    const path = window.location.pathname;
    if (path === '/' || path === '') {
        loadDashboardView();
    } else {
        const id = path.substring(1);
        if (id) loadBoardView(id);
    }
}

function navigateToDashboard() {
    history.pushState({}, '', '/');
    handleRouting();
}

function navigateToBoard(id) {
    document.getElementById('view-dashboard').classList.remove('active');
    setTimeout(() => {
        history.pushState({}, '', '/' + id);
        handleRouting();
    }, 10);
}

function logout() {
    isLoggingIn = false;
    isCheckingSession = false;
    localStorage.removeItem('authToken');
    authToken = null;
    currentUser = null;
    location.href = '/';
}

async function loadDashboardView() {
    if (currentBoardId && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'LEAVE_BOARD' }));
    }
    currentBoardId = null;

    const activeUsers = document.getElementById('active-users-list');

    activeUsers.classList.add('is-hiding');

    await new Promise(resolve => {
        activeUsers.addEventListener('transitionend', resolve, { once: true });
    });

    activeUsers.innerHTML = '';
    activeUsers.classList.remove('is-hiding');

    document.getElementById('view-board').classList.remove('active');
    document.getElementById('view-dashboard').classList.add('active');
    await loadBoards();
}

async function loadBoards() {
    if (!currentUser) {
        console.log('No user logged in');
        return;
    }
    const data = await api(`/api/boards`);
    if (!data || !data.boards) {
        console.log('No boards data');
        return;
    }
    const grid = document.getElementById('boards-grid');
    if (!grid) return;
    grid.innerHTML = data.boards.map(b => `
        <div class="board-card" onclick="navigateToBoard('${b._id}')">
            <div class="board-title">${escape(b.title)}</div>
            <div class="board-meta"><svg width="15px" height="15px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 21V19C22 17.1362 20.7252 15.5701 19 15.126M15.5 3.29076C16.9659 3.88415 18 5.32131 18 7C18 8.67869 16.9659 10.1159 15.5 10.7092M17 21C17 19.1362 17 18.2044 16.6955 17.4693C16.2895 16.4892 15.5108 15.7105 14.5307 15.3045C13.7956 15 12.8638 15 11 15H8C6.13623 15 5.20435 15 4.46927 15.3045C3.48915 15.7105 2.71046 16.4892 2.30448 17.4693C2 18.2044 2 19.1362 2 21M13.5 7C13.5 9.20914 11.7091 11 9.5 11C7.29086 11 5.5 9.20914 5.5 7C5.5 4.79086 7.29086 3 9.5 3C11.7091 3 13.5 4.79086 13.5 7Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${b.members.length + 1} member(-s)</div>
        </div>
    `).join('');
}

async function loadBoardView(id) {
    currentBoardId = id;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'JOIN_BOARD', boardId: id }));
    }

    const res = await loadBoardData(id);
    if (res && res.error) {
        showToast(res.error, 'error');
        navigateToDashboard();
        return;
    }

    document.getElementById('view-board').classList.add('active');
}

async function loadBoardData(id) {
    const data = await api(`/api/boards/data?boardId=${id}`);
    if (data.error) return data;
    boardData = data;
    document.getElementById('board-title').innerText = boardData.board.title;

    const canEdit = boardData.myRole === 'edit' || boardData.myRole === 'owner';
    const boardActions = document.getElementById('board-actions');
    boardActions.style.visibility = (canEdit || boardData.myRole === 'owner') ? 'visible' : 'hidden';

    renderBoard();
    renderHistory();
    if (currentOpenTaskId) {
        const task = boardData.tasks.find(t => t._id === currentOpenTaskId);
        if (task) renderComments(task.comments);
        else closeModal('edit-modal');
    }
    return data;
}

function renderUserAvatar(user, size = 30) {
    if (!user) return `<div class="avatar-small" style="width:${size}px; height:${size}px">?</div>`;
    if (user.avatar) {
        return `<img src="${user.avatar}" class="avatar-small" style="width:${size}px; height:${size}px; border:none;">`;
    }
    const initials = user.displayName ? user.displayName.substring(0, 2).toUpperCase() : '??';
    return `<div class="avatar-small" style="width:${size}px; height:${size}px">${initials}</div>`;
}

function updateActiveUsers(users) {
    const container = document.getElementById('active-users-list');

    container.innerHTML = users.slice(0, 5).map(u => {
        const tooltip = `${escape(u.displayName)} (@${escape(u.username)})`;

        return `<div title="${tooltip}">${renderUserAvatar(u)}</div>`;
    }).join('');

    if (users.length > 5) {
        container.innerHTML += `<div class="avatar-small">+${users.length - 5}</div>`;
    }
}

let columnSortable = null;
let taskSortables = [];

function renderBoard() {
    const container = document.getElementById('board-container');
    container.innerHTML = '';
    const canEdit = boardData.myRole === 'edit' || boardData.myRole === 'owner';

    if (columnSortable) {
        columnSortable.destroy();
        columnSortable = null;
    }
    taskSortables.forEach(sortable => sortable.destroy());
    taskSortables = [];

    boardData.columns.forEach(col => {
        const tasks = boardData.tasks.filter(t => t.columnId === col._id).sort((a, b) => a.order - b.order);
        const colEl = document.createElement('div');
        colEl.className = 'column';
        colEl.setAttribute('data-id', col._id);

        colEl.innerHTML = `
            <div class="column-header">
                <span>${escape(col.title)} <span style="color:var(--text-muted); font-weight:400; font-size:0.8em; margin-left:5px;">${tasks.length}</span></span>
                ${canEdit ? `<button class="btn-icon" style="width:24px; height:24px;" onclick="askDeleteColumn('${col._id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
            </div>
            <div class="task-list" data-col-id="${col._id}">${tasks.map(t => renderTaskHTML(t)).join('')}</div>
            <div style="padding:12px;">
                ${canEdit ? `<button class="btn btn-ghost" style="width:100%; border-style:dashed;" onclick="createTaskUI('${col._id}')">+ Add Task</button>` : ''}
            </div>
        `;

        container.appendChild(colEl);
    });

    if (canEdit) {
        columnSortable = new Sortable(container, {
            animation: 150,
            handle: '.column-header',
            filter: '.btn-icon',
            preventOnFilter: false,
            onEnd: function(evt) {
                const columnId = evt.item.getAttribute('data-id');
                const newIndex = evt.newIndex;
                api('/api/columns/reorder', 'PUT', {
                    columnId: columnId,
                    newIndex: newIndex,
                    boardId: currentBoardId
                });
            }
        });

        container.querySelectorAll('.task-list').forEach(list => {
            const sortable = new Sortable(list, {
                group: 'tasks',
                animation: 150,
                onStart: function() {
                    document.body.classList.add('is-dragging');
                },
                onEnd: async function(evt) {
                    const taskId = evt.item.getAttribute('data-id');
                    const targetColumnId = evt.to.getAttribute('data-col-id');
                    const newIndex = evt.newIndex;

                    await api('/api/tasks/reorder', 'PUT', {
                        taskId: taskId,
                        targetColumnId: targetColumnId,
                        newIndex: newIndex,
                        boardId: currentBoardId
                    });

                    document.body.classList.remove('is-dragging');
                }
            });
            taskSortables.push(sortable);
        });
    }
}

function renderTaskHTML(task) {
    const hasAtt = task.comments.some(c => c.attachments && c.attachments.length > 0);

    const pColors = {
        Low: 'var(--priority-low)',
        Normal: 'var(--priority-normal)',
        High: 'var(--priority-high)',
        Critical: 'var(--priority-critical)'
    };

    const canEdit = boardData.myRole === 'edit' || boardData.myRole === 'owner';
    const authorObj = boardData.users[task.author] || { displayName: task.author };

    return `
        <div class="task"
            data-id="${task._id}"
            style="border-left:3px solid ${task.color}"
            onclick="openEditTask('${task._id}')">

            <div style="display:flex; align-items:center; margin-bottom:8px; gap:6px;">
                <span class="priority-indicator" style="background:${pColors[task.priority]}"></span>
                <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">
                    ${task.priority}
                </span>
                ${hasAtt ? `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M21.1525 10.8995L12.1369 19.9151C10.0866 21.9653 6.7625 21.9653 4.71225 19.9151C2.662 17.8648 2.662 14.5407 4.71225 12.4904L13.7279 3.47483C15.0947 2.108 17.3108 2.108 18.6776 3.47483C20.0444 4.84167 20.0444 7.05775 18.6776 8.42458L10.0156 17.0866C9.33213 17.7701 8.22409 17.7701 7.54068 17.0866C6.85726 16.4032 6.85726 15.2952 7.54068 14.6118L15.1421 7.01037"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"/>
                    </svg>
                ` : ''}
            </div>

            <div style="line-height:1.4; font-size:0.9rem;">
                ${escape(task.content)}
            </div>

            <div style="margin-top:10px; font-size:0.75rem; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; gap:4px; align-items:center;">
                    💬 ${task.comments.length}
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="opacity:0.7">${escape(authorObj.displayName)}</span>
                    ${renderUserAvatar(authorObj, 18)}
                </div>
            </div>
        </div>
    `;
}


function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    if (id === 'edit-modal') { currentOpenTaskId = null; cancelReply(); }
}

function createTaskUI(colId) {
    document.getElementById('create-column-id').value = colId;
    document.getElementById('create-content').value = '';
    openModal('create-modal');
    setTimeout(() => document.getElementById('create-content').focus(), 100);
}

async function submitCreateTask() {
    const content = document.getElementById('create-content').value;
    if (!content.trim()) return;
    const body = {
        content, priority: document.getElementById('create-priority').value,
        color: document.getElementById('create-color').value, columnId: document.getElementById('create-column-id').value,
        boardId: currentBoardId
    };
    await api('/api/tasks/create', 'POST', body);
    closeModal('create-modal');
}

function openEditTask(id) {
    currentOpenTaskId = id;
    const task = boardData.tasks.find(t => t._id === id);
    if (!task) return;
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-content').value = task.content;
    document.getElementById('edit-color').value = task.color;
    const sel = document.getElementById('edit-priority');
    sel.innerHTML = ['Low', 'Normal', 'High', 'Critical'].map(p => `<option value="${p}" ${p === task.priority ? 'selected' : ''}>${p}</option>`).join('');

    const canEdit = boardData.myRole === 'edit' || boardData.myRole === 'owner';
    document.getElementById('edit-content').disabled = !canEdit;
    document.getElementById('edit-color').disabled = !canEdit;
    document.getElementById('edit-priority').disabled = !canEdit;
    document.getElementById('btn-save-task').style.display = canEdit ? 'block' : 'none';
    document.getElementById('btn-delete-task').style.display = canEdit ? 'block' : 'none';

    const canComment = boardData.myRole !== 'view';
    document.getElementById('comment-area').style.display = canComment ? 'flex' : 'none';

    renderComments(task.comments);
    openModal('edit-modal');
}

async function saveTask() {
    const body = {
        taskId: document.getElementById('edit-id').value,
        content: document.getElementById('edit-content').value,
        priority: document.getElementById('edit-priority').value,
        color: document.getElementById('edit-color').value
    };
    await api('/api/tasks/update', 'PUT', body);
    showToast('Changes saved');
}

function startReply(id, author) {
    currentReplyTo = id;
    document.getElementById('reply-box').style.display = 'flex';
    document.getElementById('reply-to-name').innerText = author;
    document.getElementById('new-comment').focus();
}
function cancelReply() {
    currentReplyTo = null;
    document.getElementById('reply-box').style.display = 'none';
}

function promptEditComment(cid, txt) {
    document.getElementById('simple-title').innerText = 'Edit Comment';
    document.getElementById('simple-input').style.display = 'none';
    document.getElementById('simple-textarea').style.display = 'block';
    document.getElementById('simple-textarea').value = txt;
    document.getElementById('simple-msg').style.display = 'none';
    const btn = document.getElementById('simple-confirm-btn');
    btn.innerText = 'Save';
    btn.className = 'btn btn-primary';
    simpleCb = async () => {
        const newText = document.getElementById('simple-textarea').value;
        const res = await api('/api/comments/edit', 'PUT', { taskId: currentOpenTaskId, commentId: cid, text: newText });
        if (res.success) {
        } else showToast(res.error, 'error');
    };
    openModal('simple-modal');
    setTimeout(() => document.getElementById('simple-textarea').focus(), 100);
}

function askDeleteComment(cid) {
    document.getElementById('simple-title').innerText = 'Delete Comment?';
    document.getElementById('simple-input').style.display = 'none';
    document.getElementById('simple-textarea').style.display = 'none';
    document.getElementById('simple-msg').style.display = 'block';
    document.getElementById('simple-msg').innerText = 'Cannot be undone.';
    const btn = document.getElementById('simple-confirm-btn');
    btn.innerText = 'Delete';
    btn.className = 'btn btn-danger';
    simpleCb = () => api('/api/comments/delete', 'DELETE', { taskId: currentOpenTaskId, commentId: cid });
    openModal('simple-modal');
}

function renderComments(comments) {
    const list = document.getElementById('comments-list');
    const commentMap = {};
    comments.forEach(c => commentMap[c._id] = c);

    list.innerHTML = comments.map(c => {
        const isOwn = c.author === currentUser.username;
        const authorObj = boardData.users[c.author] || { displayName: c.author };
        let replyBlock = '';
        if (c.replyTo && commentMap[c.replyTo]) {
            const r = commentMap[c.replyTo];
            const rAuth = boardData.users[r.author] || { displayName: r.author };
            replyBlock = `<div class="reply-indicator">Re: <b>${escape(rAuth.displayName)}</b> ${escape(r.text.substring(0, 30))}...</div>`;
        }

        return `
            <div style="display:flex; flex-direction:column; ${isOwn ? 'align-items:flex-end' : 'align-items:flex-start'}">
                 <div class="comment-meta" style="display:flex; ${isOwn ? 'flex-direction:row-reverse' : ''}; gap:8px; font-size:0.75rem; color:#a1a1aa; align-items:center; margin-bottom:4px;">
                    ${renderUserAvatar(authorObj, 20)}
                    <span style="font-weight:600; color:#f4f4f5;">${escape(authorObj.displayName)}</span>
                    <span>${new Date(c.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${c.editedAt ? '(edited)' : ''}</span>
                    <span style="cursor:pointer; color:var(--primary);" onclick="startReply('${c._id}', '${escape(authorObj.displayName)}')"><svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 14L4 9M4 9L9 4M4 9H10.4C13.7603 9 15.4405 9 16.7239 9.65396C17.8529 10.2292 18.7708 11.1471 19.346 12.2761C20 13.5595 20 15.2397 20 18.6V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                    ${isOwn ? `
                        <span style="cursor:pointer; color:var(--text-muted);" onclick="promptEditComment('${c._id}', '${escape(c.text).replace(/'/g, "\\'")}')"><svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 10L14 6M2.49997 21.5L5.88434 21.124C6.29783 21.078 6.50457 21.055 6.69782 20.9925C6.86926 20.937 7.03242 20.8586 7.18286 20.7594C7.35242 20.6475 7.49951 20.5005 7.7937 20.2063L21 7C22.1046 5.89543 22.1046 4.10457 21 3C19.8954 1.89543 18.1046 1.89543 17 3L3.7937 16.2063C3.49952 16.5005 3.35242 16.6475 3.24061 16.8171C3.1414 16.9676 3.06298 17.1307 3.00748 17.3022C2.94493 17.4954 2.92195 17.7021 2.87601 18.1156L2.49997 21.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                        <span style="cursor:pointer; color:var(--danger);" onclick="askDeleteComment('${c._id}')"><svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 6V5.2C16 4.0799 16 3.51984 15.782 3.09202C15.5903 2.71569 15.2843 2.40973 14.908 2.21799C14.4802 2 13.9201 2 12.8 2H11.2C10.0799 2 9.51984 2 9.09202 2.21799C8.71569 2.40973 8.40973 2.71569 8.21799 3.09202C8 3.51984 8 4.0799 8 5.2V6M10 11.5V16.5M14 11.5V16.5M3 6H21M19 6V17.2C19 18.8802 19 19.7202 18.673 20.362C18.3854 20.9265 17.9265 21.3854 17.362 21.673C16.7202 22 15.8802 22 14.2 22H9.8C8.11984 22 7.27976 22 6.63803 21.673C6.07354 21.3854 5.6146 20.9265 5.32698 20.362C5 19.7202 5 18.8802 5 17.2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                    ` : ''}
                 </div>
                 <div class="msg-bubble ${isOwn ? 'own' : ''}">
                    ${replyBlock}
                    <div style="white-space: pre-wrap;">${escape(c.text)}</div>
                   ${c.attachments.length ? '<div class="attachment-grid">' +
                c.attachments
                    .slice()
                    .sort((a, b) => {
                        const priority = { 'image': 1, 'video': 2, 'file': 3 };
                        const typeA = priority[a.type] || 3;
                        const typeB = priority[b.type] || 3;
                        return typeA - typeB;
                    })
                    .map(a => {
                        if (a.type === 'image') return `<img src="${a.url}" class="att-thumb" onclick="viewMedia('${a.url}','img')">`;
                        if (a.type === 'video') return `<video src="${a.url}" class="att-thumb" onclick="viewMedia('${a.url}','vid')"></video>`;
                        return `<a href="${a.url}" target="_blank" style="color:white; display:block; margin-top:4px; font-size:0.8rem;">${escape(a.originalName)}</a>`;
                    }).join('') + '</div>' : ''}
                 </div>
            </div>
        `;
    }).join('');
    setTimeout(() => list.scrollTop = list.scrollHeight, 0);
}

function showFileCount() {
    const n = document.getElementById('comment-files').files.length;
    document.getElementById('file-count').innerText = n ? `${n} attached` : '';
}

async function addComment() {
    const text = document.getElementById('new-comment').value;
    const files = document.getElementById('comment-files').files;

    const formData = new FormData();
    formData.append('taskId', document.getElementById('edit-id').value);
    formData.append('text', text);
    if (currentReplyTo) formData.append('replyTo', currentReplyTo);
    for (let f of files) formData.append('files', f);

    const res = await api('/api/tasks/comment', 'POST', formData, true);
    if (res.success) {
        document.getElementById('new-comment').value = '';
        document.getElementById('comment-files').value = '';
        document.getElementById('file-count').innerText = '';
        cancelReply();
    } else showToast(res.error, 'error');
}

function openMembersModal() {
    const list = document.getElementById('members-list');
    const isOwner = boardData.myRole === 'owner';
    document.getElementById('invite-section').style.display = isOwner ? 'flex' : 'none';

    const render = () => {
        let html = '';
        boardData.members.forEach(m => {
            const uObj = boardData.users[m.user] || { displayName: m.user };
            html += `
                <div class="member-list-item">
                    <div class="member-info">
                        ${renderUserAvatar(uObj)}
                        <div>
                            <span style="font-weight:600; color:${m.user === boardData.board.owner ? 'var(--primary)' : 'var(--text-main)'}">${escape(uObj.displayName)}</span>
                            <div style="font-size:0.75rem; color:var(--text-muted);">@${m.user} ${m.user === boardData.board.owner ? '(Owner)' : ''}</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${isOwner && m.user !== boardData.board.owner ? `
                            <select style="width:auto; padding:4px;" onchange="changeRole('${m.user}', this.value)">
                                <option value="view" ${m.role === 'view' ? 'selected' : ''}>View</option>
                                <option value="comment" ${m.role === 'comment' ? 'selected' : ''}>Comment</option>
                                <option value="edit" ${m.role === 'edit' ? 'selected' : ''}>Edit</option>
                            </select>
                            <button class="btn btn-danger" style="padding:4px 8px; font-size:0.75rem;" onclick="kickMember('${m.user}')">Remove</button>
                        ` : `<span style="font-size:0.8rem; color:var(--text-muted);">${m.role}</span>`}
                    </div>
                </div>
            `;
        });
        list.innerHTML = html;
    }
    render();
    openModal('members-modal');
}

async function changeRole(username, role) {
    await api('/api/boards/role', 'PUT', { boardId: currentBoardId, username, role });
}

async function kickMember(username) {
    await api('/api/boards/member', 'DELETE', { boardId: currentBoardId, username });
}

async function inviteUser() {
    const username = document.getElementById('invite-username').value;
    if (!username) return;
    const res = await api('/api/boards/invite', 'POST', { boardId: currentBoardId, username });
    if (res.success) {
        document.getElementById('invite-username').value = '';
        showToast('User invited');
    } else showToast(res.error, 'error');
}

let simpleCb = null;
function promptSimple(title, placeholder, cb) {
    document.getElementById('simple-title').innerText = title;
    document.getElementById('simple-input').placeholder = placeholder;
    document.getElementById('simple-input').style.display = 'block';
    document.getElementById('simple-textarea').style.display = 'none';
    document.getElementById('simple-msg').style.display = 'none';
    document.getElementById('simple-input').value = '';
    const btn = document.getElementById('simple-confirm-btn');
    btn.innerText = 'Confirm';
    btn.className = 'btn btn-primary';
    simpleCb = async () => { if (document.getElementById('simple-input').value) await cb(document.getElementById('simple-input').value); };
    openModal('simple-modal');
    setTimeout(() => document.getElementById('simple-input').focus(), 100);
}

function promptCreateBoard() {
    promptSimple('Create Board', 'Board Title', async (title) => {
        console.log("trying to send api");
        const res = await api('/api/boards/create', 'POST', { title });
        if (res.success) loadBoards();
    });
}

function promptColumn() {
    promptSimple('New Column', 'Title', async (title) => {
        await api('/api/columns/create', 'POST', { title, boardId: currentBoardId });
    });
}

function askDeleteBoard() {
    document.getElementById('simple-title').innerText = 'Delete Board?';
    document.getElementById('simple-input').style.display = 'none';
    document.getElementById('simple-textarea').style.display = 'none';
    document.getElementById('simple-msg').style.display = 'block';
    document.getElementById('simple-msg').innerText = 'All data will be lost.';
    const btn = document.getElementById('simple-confirm-btn');
    btn.innerText = 'Delete';
    btn.className = 'btn btn-danger';
    simpleCb = async () => {
        await api('/api/boards/delete', 'DELETE', { boardId: currentBoardId });
        loadBoards();
        navigateToDashboard();
    };
    openModal('simple-modal');
}

function askDeleteColumn(id) {
    document.getElementById('simple-title').innerText = 'Delete Column?';
    document.getElementById('simple-input').style.display = 'none';
    document.getElementById('simple-textarea').style.display = 'none';
    document.getElementById('simple-msg').style.display = 'block';
    document.getElementById('simple-msg').innerText = 'Tasks inside will be lost.';
    const btn = document.getElementById('simple-confirm-btn');
    btn.innerText = 'Delete';
    btn.className = 'btn btn-danger';
    simpleCb = () => api('/api/columns/delete', 'DELETE', { columnId: id, boardId: currentBoardId });
    openModal('simple-modal');
}

function askDeleteTask() {
    document.getElementById('simple-title').innerText = 'Delete Task?';
    document.getElementById('simple-input').style.display = 'none';
    document.getElementById('simple-textarea').style.display = 'none';
    document.getElementById('simple-msg').style.display = 'block';
    document.getElementById('simple-msg').innerText = 'Cannot be undone.';
    const btn = document.getElementById('simple-confirm-btn');
    btn.innerText = 'Delete';
    btn.className = 'btn btn-danger';
    simpleCb = async () => {
        await api('/api/tasks/delete', 'DELETE', { taskId: document.getElementById('edit-id').value });
    };
    openModal('simple-modal');
}

document.getElementById('simple-confirm-btn').onclick = async () => { if (simpleCb) await simpleCb(); closeModal('simple-modal'); };

function renderHistory() {
    document.getElementById('history-list').innerHTML = boardData.history.map(h => {
        const uObj = boardData.users[h.user] || { displayName: h.user };
        return `
        <div class="h-item">
            <span style="color:var(--primary); font-weight:600;">${escape(uObj.displayName)}</span> ${escape(h.text)}
            <span class="h-time">${new Date(h.date).toLocaleString()}</span>
        </div>
    `}).join('');
}

function viewMedia(url, type) {
    const c = document.getElementById('lb-content');
    c.innerHTML = type === 'img' ? `<img src="${url}">` : `<video src="${url}" controls autoplay></video>`;
    document.getElementById('lightbox').classList.add('open');
}

function toggleHistory() { document.getElementById('history-panel').classList.toggle('open'); }
function showToast(msg, type) {
    const t = document.createElement('div');
    t.className = `toast ${type === 'error' ? 'error' : ''}`;
    t.innerText = msg;
    document.getElementById('toast-box').appendChild(t);
    setTimeout(() => t.remove(), 3000);
}