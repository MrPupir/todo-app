require('dotenv').config();

const ITERATIONS = Number(process.env.PASSWORD_ITERATIONS || 1000);
const MONGO_URI = process.env.MONGO_URI;
const TOKEN_EXPIRES_DAYS = Number(process.env.TOKEN_EXPIRES_DAYS || 7);
const PORT = process.env.PORT || 3000;

const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function deleteFile(fileUrl) {
    if (!fileUrl) return;
    const filename = path.basename(fileUrl);
    const fullPath = path.join(uploadDir, filename);

    fs.unlink(fullPath, (err) => {
        if (err && err.code !== 'ENOENT') console.error(`Failed to delete ${filename}:`, err);
    });
}

function deleteTaskAttachments(task) {
    if (!task.comments) return;
    task.comments.forEach(comment => {
        if (comment.attachments && comment.attachments.length > 0) {
            comment.attachments.forEach(att => deleteFile(att.url));
        }
    });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

app.get('/uploads/:filename', async (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);
    const fileUrl = '/uploads/' + filename;

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }

    try {
        const task = await Task.findOne({
            'comments.attachments.url': fileUrl
        });

        let originalName = filename;

        if (task) {
            for (const comment of task.comments) {
                const attachment = comment.attachments.find(a => a.url === fileUrl);
                if (attachment && attachment.originalName) {
                    originalName = attachment.originalName;
                    break;
                }
            }
        }

        res.download(filePath, originalName, (err) => {
            if (err) {
                console.error('Error downloading file:', err);
            }
        });

    } catch (err) {
        console.error(err);
        res.download(filePath, filename);
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(MONGO_URI)
    .catch(err => console.error(err));

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    displayName: { type: String },
    avatar: { type: String },
    hash: String,
    salt: String,
    token: String,
    tokenExp: Date
});

UserSchema.methods.setPassword = function (password) {
    this.salt = crypto.randomBytes(16).toString('hex');
    this.hash = crypto.pbkdf2Sync(password, this.salt, ITERATIONS, 64, 'sha512').toString('hex');
};

UserSchema.methods.validPassword = function (password) {
    const hash = crypto.pbkdf2Sync(password, this.salt, ITERATIONS, 64, 'sha512').toString('hex');
    return this.hash === hash;
};

const BoardSchema = new mongoose.Schema({
    title: { type: String, required: true },
    owner: { type: String, required: true },
    members: [{
        user: String,
        role: { type: String, enum: ['view', 'comment', 'edit'], default: 'comment' }
    }],
    created: { type: Date, default: Date.now }
});

const ColumnSchema = new mongoose.Schema({
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    title: { type: String, required: true },
    order: { type: Number, default: 0 },
    created: { type: Date, default: Date.now }
});

const TaskSchema = new mongoose.Schema({
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    columnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Column' },
    content: { type: String, required: true },
    priority: { type: String, default: 'Normal' },
    color: { type: String, default: '#27272a' },
    order: { type: Number, default: 0 },
    comments: [{
        _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
        text: String,
        author: String,
        replyTo: { type: mongoose.Schema.Types.Mixed, default: null },
        created: { type: Date, default: Date.now },
        editedAt: Date,
        attachments: [{ type: { type: String }, url: String, originalName: String }]
    }],
    created: { type: Date, default: Date.now },
    author: String
});

const HistorySchema = new mongoose.Schema({
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    text: String,
    user: String,
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Board = mongoose.model('Board', BoardSchema);
const Column = mongoose.model('Column', ColumnSchema);
const Task = mongoose.model('Task', TaskSchema);
const History = mongoose.model('History', HistorySchema);

async function authenticate(req, res, next) {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findOne({ token, tokenExp: { $gt: new Date() } });
    if (!user) return res.status(401).json({ error: 'Invalid Token' });
    req.user = user;
    next();
}

async function getBoardAccess(boardId, username) {
    if (!boardId) return null;
    const board = await Board.findById(boardId);
    if (!board) return null;
    if (board.owner === username) return 'owner';
    const member = board.members.find(m => m.user === username);
    return member ? member.role : null;
}

function broadcastToBoard(boardId, data) {
    const boardIdStr = boardId.toString();
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.boardId === boardIdStr) {
            c.send(JSON.stringify(data));
        }
    });
}

function sendToUser(username, data) {
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.username === username) {
            c.send(JSON.stringify(data));
        }
    });
}

function broadcastPresence(boardId) {
    const boardIdStr = boardId.toString();
    const activeUsers = [];
    const seenUsernames = new Set();

    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.boardId === boardIdStr && c.username) {
            if (!seenUsernames.has(c.username)) {
                seenUsernames.add(c.username);
                activeUsers.push({
                    username: c.username,
                    displayName: c.displayName || c.username,
                    avatar: c.avatar
                });
            }
        }
    });

    broadcastToBoard(boardIdStr, { type: 'PRESENCE', users: activeUsers });
}

async function logAction(boardId, user, text) {
    await History.create({ boardId, user, text });
}

wss.on('connection', ws => {
    ws.isAlive = true;
    ws.boardId = null;
    ws.username = null;

    ws.on('pong', () => ws.isAlive = true);

    ws.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'AUTH') {
                const user = await User.findOne({ token: data.token, tokenExp: { $gt: new Date() } });
                if (user) {
                    ws.username = user.username;
                    ws.displayName = user.displayName;
                    ws.avatar = user.avatar;
                    ws.send(JSON.stringify({ type: 'AUTH_OK' }));
                }
            }
            if (data.type === 'JOIN_BOARD') {
                if (!ws.username) return;
                const role = await getBoardAccess(data.boardId, ws.username);
                if (role) {
                    ws.boardId = data.boardId;
                    broadcastPresence(data.boardId);
                }
            }
            if (data.type === 'LEAVE_BOARD') {
                const oldBoard = ws.boardId;
                ws.boardId = null;
                if (oldBoard) broadcastPresence(oldBoard);
            }
        } catch (e) { }
    });

    ws.on('close', () => {
        if (ws.boardId) broadcastPresence(ws.boardId);
    });
});

setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

app.post('/api/auth/register', (req, res, next) => {
    uploadAvatar.single('avatar')(req, res, (err) => {
        if (err) return res.json({ success: false, error: err.message });
        next();
    });
}, async (req, res) => {
    try {
        const { username, password, displayName } = req.body;
        if (!/^[a-zA-Z0-9]+$/.test(username)) return res.json({ success: false, error: 'Username must be alphanumeric' });

        const existing = await User.findOne({ username });
        if (existing) return res.json({ success: false, error: 'Username taken' });

        const user = new User({ username, displayName: displayName || username });
        if (req.file) user.avatar = '/uploads/' + req.file.filename;

        user.setPassword(password);
        user.token = crypto.randomBytes(32).toString('hex');
        user.tokenExp = new Date(Date.now() + 86400000 * TOKEN_EXPIRES_DAYS);
        await user.save();

        res.json({ success: true, token: user.token, user: { username: user.username, displayName: user.displayName, avatar: user.avatar } });
    } catch (err) {
        res.json({ success: false, error: 'Error registering' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !user.validPassword(password)) return res.json({ success: false, error: 'Invalid credentials' });

    user.token = crypto.randomBytes(32).toString('hex');
    user.tokenExp = new Date(Date.now() + 86400000 * TOKEN_EXPIRES_DAYS);
    await user.save();

    res.json({ success: true, token: user.token, user: { username: user.username, displayName: user.displayName, avatar: user.avatar } });
});

app.post('/api/auth/check', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ success: false });
    const user = await User.findOne({ token, tokenExp: { $gt: new Date() } });
    if (!user) return res.json({ success: false });
    res.json({ success: true, username: user.username, displayName: user.displayName, avatar: user.avatar });
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
    req.user.token = null;
    req.user.tokenExp = null;
    await req.user.save();
    res.json({ success: true });
});

const avatarFileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Неверный формат. Разрешены только картинки (JPG, PNG, GIF, WEBP).'), false);
    }
};

const uploadAvatar = multer({
    storage: storage,
    fileFilter: avatarFileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.put('/api/users/avatar', authenticate, (req, res, next) => {
    uploadAvatar.single('avatar')(req, res, (err) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        next();
    });
}, async (req, res) => {
    if (req.file) {
        if (req.user.avatar) {
            deleteFile(req.user.avatar);
        }

        req.user.avatar = '/uploads/' + req.file.filename;
        await req.user.save();
        res.json({ success: true, avatar: req.user.avatar });
    } else {
        res.json({ success: false, error: 'Файл не загружен' });
    }
});

app.delete('/api/users/avatar', authenticate, async (req, res) => {
    if (req.user.avatar) {
        deleteFile(req.user.avatar);
    }

    req.user.avatar = null;
    await req.user.save();
    res.json({ success: true });
});

app.put('/api/users/profile', authenticate, async (req, res) => {
    const { displayName } = req.body;
    if (displayName) {
        req.user.displayName = displayName;
        await req.user.save();
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Display name required' });
    }
});

app.get('/api/boards', authenticate, async (req, res) => {
    const owned = await Board.find({ owner: req.user.username }).sort({ created: -1 });
    const shared = await Board.find({ 'members.user': req.user.username }).sort({ created: -1 });
    res.json({ boards: [...owned, ...shared] });
});

app.post('/api/boards/create', authenticate, async (req, res) => {
    const { title } = req.body;
    const board = await Board.create({ title, owner: req.user.username });
    res.json({ success: true, boardId: board._id });
});

app.delete('/api/boards/delete', authenticate, async (req, res) => {
    const { boardId } = req.body;
    const board = await Board.findById(boardId);
    if (board && board.owner === req.user.username) {
        const tasks = await Task.find({ boardId });
        tasks.forEach(task => deleteTaskAttachments(task));

        await Column.deleteMany({ boardId });
        await Task.deleteMany({ boardId });
        await History.deleteMany({ boardId });
        await Board.findByIdAndDelete(boardId);
        broadcastToBoard(boardId, { type: 'BOARD_DELETED' });
    }
    res.json({ success: true });
});

app.post('/api/boards/invite', authenticate, async (req, res) => {
    const { boardId, username } = req.body;
    const board = await Board.findById(boardId);
    if (!board || board.owner !== req.user.username) return res.json({ success: false, error: 'Access denied' });

    const invitee = await User.findOne({ username });
    if (!invitee) return res.json({ success: false, error: 'User not found' });
    if (board.owner === username) return res.json({ success: false, error: 'Already owner' });
    if (board.members.find(m => m.user === username)) return res.json({ success: false, error: 'Already invited' });

    board.members.push({ user: username, role: 'comment' });
    await board.save();
    await logAction(boardId, req.user.username, `Invited ${username}`);

    broadcastToBoard(boardId, { type: 'MEMBER_UPDATED' });
    res.json({ success: true });
});

app.put('/api/boards/role', authenticate, async (req, res) => {
    const { boardId, username, role } = req.body;
    const board = await Board.findById(boardId);
    if (!board || board.owner !== req.user.username) return res.status(403).json({ error: 'Forbidden' });

    const member = board.members.find(m => m.user === username);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    member.role = role;
    await board.save();
    await logAction(boardId, req.user.username, `Changed ${username} role to ${role}`);

    broadcastToBoard(boardId, { type: 'MEMBER_UPDATED' });
    res.json({ success: true });
});

app.delete('/api/boards/member', authenticate, async (req, res) => {
    const { boardId, username } = req.body;
    const board = await Board.findById(boardId);
    if (!board || board.owner !== req.user.username) return res.status(403).json({ error: 'Forbidden' });

    board.members = board.members.filter(m => m.user !== username);
    await board.save();
    await logAction(boardId, req.user.username, `Removed ${username}`);

    sendToUser(username, { type: 'KICKED', boardId });
    broadcastToBoard(boardId, { type: 'MEMBER_UPDATED' });
    res.json({ success: true });
});

app.get('/api/data', authenticate, async (req, res) => {
    const { boardId } = req.query;
    const role = await getBoardAccess(boardId, req.user.username);
    if (!role) return res.status(403).json({ error: 'Access Denied' });

    const columns = await Column.find({ boardId }).sort({ order: 1 });
    const tasks = await Task.find({ boardId }).sort({ order: 1 });
    const history = await History.find({ boardId }).sort({ date: -1 }).limit(50);
    const board = await Board.findById(boardId);

    const members = [{ user: board.owner, role: 'owner' }, ...board.members];

    const allUsernames = new Set();
    members.forEach(m => allUsernames.add(m.user));
    tasks.forEach(t => {
        allUsernames.add(t.author);
        t.comments.forEach(c => allUsernames.add(c.author));
    });
    history.forEach(h => allUsernames.add(h.user));

    const usersData = await User.find({ username: { $in: Array.from(allUsernames) } }).select('username displayName avatar');
    const usersMap = {};
    usersData.forEach(u => usersMap[u.username] = u);

    res.json({ columns, tasks, history, board, members, myRole: role, users: usersMap });
});

app.post('/api/columns/create', authenticate, async (req, res) => {
    const { title, boardId } = req.body;
    const role = await getBoardAccess(boardId, req.user.username);
    if (role !== 'edit' && role !== 'owner') return res.status(403).json({ error: 'Forbidden' });

    const count = await Column.countDocuments({ boardId });
    await Column.create({ title, boardId, order: count });
    await logAction(boardId, req.user.username, `Added column "${title}"`);
    broadcastToBoard(boardId, { type: 'UPDATE' });
    res.json({ success: true });
});

app.delete('/api/columns/delete', authenticate, async (req, res) => {
    const { columnId, boardId } = req.body;
    const role = await getBoardAccess(boardId, req.user.username);
    if (role !== 'edit' && role !== 'owner') return res.status(403).json({ error: 'Forbidden' });

    const col = await Column.findById(columnId);
    if (col) {
        const tasks = await Task.find({ columnId });
        tasks.forEach(task => deleteTaskAttachments(task));

        await Task.deleteMany({ columnId });
        await Column.findByIdAndDelete(columnId);
        await logAction(boardId, req.user.username, `Deleted column "${col.title}"`);
        broadcastToBoard(boardId, { type: 'UPDATE' });
    }
    res.json({ success: true });
});

app.put('/api/columns/reorder', authenticate, async (req, res) => {
    const { columnId, newIndex, boardId } = req.body;
    const role = await getBoardAccess(boardId, req.user.username);
    if (role !== 'edit' && role !== 'owner') return res.status(403).json({ error: 'Forbidden' });

    const col = await Column.findById(columnId);
    if (!col) return res.status(404).json({ error: 'Column not found' });
    
    const oldIndex = col.order;

    if (oldIndex !== newIndex) {
        if (newIndex > oldIndex) {
            await Column.updateMany({ boardId, order: { $gt: oldIndex, $lte: newIndex } }, { $inc: { order: -1 } });
        } else {
            await Column.updateMany({ boardId, order: { $gte: newIndex, $lt: oldIndex } }, { $inc: { order: 1 } });
        }
        col.order = newIndex;
        await col.save();
        broadcastToBoard(boardId, { type: 'UPDATE' });
    }
    res.json({ success: true });
});

app.post('/api/tasks/create', authenticate, async (req, res) => {
    const { content, columnId, priority, color, boardId } = req.body;
    const role = await getBoardAccess(boardId, req.user.username);
    if (role !== 'edit' && role !== 'owner') return res.status(403).json({ error: 'Forbidden' });

    const count = await Task.countDocuments({ columnId });
    await Task.create({ content, columnId, priority, color, author: req.user.username, order: count, boardId });
    await logAction(boardId, req.user.username, `Created task`);
    broadcastToBoard(boardId, { type: 'UPDATE' });
    res.json({ success: true });
});

app.put('/api/tasks/update', authenticate, async (req, res) => {
    const { taskId, priority, color, content } = req.body;
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ error: 'Not found' });

    const role = await getBoardAccess(task.boardId, req.user.username);
    if (role !== 'edit' && role !== 'owner') return res.status(403).json({ error: 'Forbidden' });

    task.priority = priority;
    task.color = color;
    task.content = content;
    await task.save();

    broadcastToBoard(task.boardId.toString(), { type: 'UPDATE' });
    res.json({ success: true });
});

app.put('/api/tasks/reorder', authenticate, async (req, res) => {
    const { taskId, targetColumnId, newIndex } = req.body;
    const task = await Task.findById(taskId);
    if (!task) return res.sendStatus(404);

    const role = await getBoardAccess(task.boardId, req.user.username);
    if (role !== 'edit' && role !== 'owner') return res.status(403).json({ error: 'Forbidden' });

    const sourceCol = task.columnId.toString();
    const oldIndex = task.order;

    if (sourceCol === targetColumnId) {
        if (oldIndex !== newIndex) {
            if (newIndex > oldIndex) {
                await Task.updateMany({ columnId: sourceCol, order: { $gt: oldIndex, $lte: newIndex } }, { $inc: { order: -1 } });
            } else {
                await Task.updateMany({ columnId: sourceCol, order: { $gte: newIndex, $lt: oldIndex } }, { $inc: { order: 1 } });
            }
            task.order = newIndex;
            await task.save();
        }
    } else {
        await Task.updateMany({ columnId: sourceCol, order: { $gt: oldIndex } }, { $inc: { order: -1 } });
        await Task.updateMany({ columnId: targetColumnId, order: { $gte: newIndex } }, { $inc: { order: 1 } });
        task.columnId = targetColumnId;
        task.order = newIndex;
        await task.save();
        await logAction(task.boardId, req.user.username, `Moved task to new column`);
    }
    broadcastToBoard(task.boardId.toString(), { type: 'UPDATE' });
    res.json({ success: true });
});

app.delete('/api/tasks/delete', authenticate, async (req, res) => {
    const { taskId } = req.body;
    const task = await Task.findById(taskId);
    if (task) {
        const role = await getBoardAccess(task.boardId, req.user.username);
        if (role !== 'edit' && role !== 'owner') return res.status(403).json({ error: 'Forbidden' });

        const boardId = task.boardId.toString();

        deleteTaskAttachments(task);

        await Task.updateMany({ columnId: task.columnId, order: { $gt: task.order } }, { $inc: { order: -1 } });
        await Task.findByIdAndDelete(taskId);
        await logAction(boardId, req.user.username, `Deleted task`);
        broadcastToBoard(boardId, { type: 'UPDATE', deletedTaskId: taskId });
    }
    res.json({ success: true });
});

app.post('/api/tasks/comment', authenticate, upload.array('files'), async (req, res) => {
    const { taskId, text, replyTo } = req.body;
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const role = await getBoardAccess(task.boardId, req.user.username);
    if (role === 'view' || !role) return res.status(403).json({ error: 'Forbidden' });

    if (!text || text.trim() === '') return res.json({ success: false, error: 'Message cannot be empty' });

    const files = req.files || [];
    const attachments = files.map(f => {
        const ext = path.extname(f.originalname).toLowerCase();
        let type = 'file';
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) type = 'image';
        if (['.mp4', '.webm'].includes(ext)) type = 'video';
        return {
            type,
            url: '/uploads/' + f.filename,
            originalName: Buffer.from(f.originalname, 'latin1').toString('utf8')
        };
    });
    task.comments.push({
        text,
        author: req.user.username,
        attachments,
        replyTo: replyTo || null
    });
    await task.save();
    broadcastToBoard(task.boardId.toString(), { type: 'UPDATE' });
    res.json({ success: true });
});

app.put('/api/comments/edit', authenticate, async (req, res) => {
    const { taskId, commentId, text } = req.body;
    const task = await Task.findById(taskId);
    if (task) {
        const comment = task.comments.id(commentId);
        if (comment && comment.author === req.user.username) {
            if (!text || text.trim() === '') return res.json({ success: false, error: 'Message cannot be empty' });

            comment.text = text;
            comment.editedAt = new Date();
            await task.save();
            broadcastToBoard(task.boardId.toString(), { type: 'UPDATE' });
            res.json({ success: true });
        } else res.json({ success: false });
    } else res.json({ success: false });
});

app.delete('/api/comments/delete', authenticate, async (req, res) => {
    const { taskId, commentId } = req.body;
    const task = await Task.findById(taskId);
    if (task) {
        const comment = task.comments.id(commentId);
        if (comment && comment.author === req.user.username) {
            if (comment.attachments && comment.attachments.length > 0) {
                comment.attachments.forEach(att => deleteFile(att.url));
            }

            task.comments.pull(commentId);
            await task.save();
            broadcastToBoard(task.boardId.toString(), { type: 'UPDATE' });
            res.json({ success: true });
        } else res.json({ success: false });
    } else res.json({ success: false });
});

app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));