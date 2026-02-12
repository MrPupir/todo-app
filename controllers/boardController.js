const AppError = require('../utils/AppError');
const { Board, Column, Task, History, User } = require('../models');
const { deleteTaskAttachments } = require('../utils/fileUtils');
const { logAction } = require('../services/historyService');
const { getBoardAccess } = require('../middleware/boardAccess');

exports.getBoards = async (req, res) => {
    const [owned, shared] = await Promise.all([
        Board.find({ owner: req.user.username }).sort({ created: -1 }).lean(),
        Board.find({ 'members.user': req.user.username }).sort({ created: -1 }).lean()
    ]);
    res.json({ boards: [...owned, ...shared] });
};

exports.createBoard = async (req, res) => {
    const { title } = req.body;
    if (!title) throw new AppError('Title is required', 400);

    const board = await Board.create({ title, owner: req.user.username });
    
    req.wsManager.broadcastAll({ type: 'BOARDS_UPDATED' });
    
    res.json({ success: true, boardId: board._id });
};

exports.renameBoard = async (req, res) => {
    const { boardId, title } = req.body;
    if (!title) throw new AppError('Title is required', 400);

    const board = await Board.findById(boardId);
    if (!board) throw new AppError('Board not found', 404);
    
    if (board.owner !== req.user.username) {
        const member = board.members.find(m => m.user === req.user.username);
        if (!member || member.role !== 'edit') throw new AppError('Forbidden', 403);
    }

    board.title = title;
    await board.save();

    await logAction(boardId, req.user.username, `Renamed board to "${title}"`);
    
    req.wsManager.broadcastToBoard(boardId, { 
        type: 'BOARD_RENAMED', 
        boardId, 
        title 
    });

    req.wsManager.broadcastAll({ type: 'BOARDS_UPDATED' });

    res.json({ success: true });
};

exports.deleteBoard = async (req, res) => {
    const { boardId } = req.body;
    const board = await Board.findById(boardId);

    if (!board) throw new AppError('Board not found', 404);
    if (board.owner !== req.user.username) throw new AppError('Only owner can delete', 403);

    const tasks = await Task.find({ boardId });
    await Promise.all(tasks.map(t => deleteTaskAttachments(t)));

    await Promise.all([
        Column.deleteMany({ boardId }),
        Task.deleteMany({ boardId }),
        History.deleteMany({ boardId }),
        Board.findByIdAndDelete(boardId)
    ]);

    req.wsManager.broadcastToBoard(boardId, { type: 'BOARD_DELETED', boardId });

    req.wsManager.broadcastAll({ type: 'BOARDS_UPDATED' });

    res.json({ success: true });
};

exports.inviteUser = async (req, res) => {
    const { boardId, username } = req.body;
    const board = await Board.findById(boardId);
    if (!board || board.owner !== req.user.username) throw new AppError('Access denied', 403);

    const invitee = await User.findOne({ username }).select('username displayName avatar');
    if (!invitee) throw new AppError('User not found', 404);
    if (board.owner === username || board.members.some(m => m.user === username)) throw new AppError('User already in board', 400);

    board.members.push({ user: username, role: 'comment' });
    await board.save();

    await logAction(boardId, req.user.username, `Invited ${username}`);
    
    req.wsManager.broadcastToBoard(boardId, { 
        type: 'MEMBER_ADDED', 
        member: { user: username, role: 'comment' },
        userData: { username: invitee.username, displayName: invitee.displayName, avatar: invitee.avatar }
    });
    
    req.wsManager.broadcastAll({ type: 'BOARDS_UPDATED' });
    
    res.json({ success: true });
};

exports.changeRole = async (req, res) => {
    const { boardId, username, role } = req.body;
    const board = await Board.findById(boardId);
    if (!board || board.owner !== req.user.username) throw new AppError('Forbidden', 403);

    const member = board.members.find(m => m.user === username);
    if (!member) throw new AppError('Member not found', 404);

    member.role = role;
    await board.save();

    await logAction(boardId, req.user.username, `Changed ${username} role to ${role}`);
    req.wsManager.broadcastToBoard(boardId, { 
        type: 'MEMBER_ROLE_UPDATED', 
        username, 
        role 
    });
    res.json({ success: true });
};

exports.removeMember = async (req, res) => {
    const { boardId, username } = req.body;
    const board = await Board.findById(boardId);
    if (!board || board.owner !== req.user.username) throw new AppError('Forbidden', 403);

    board.members = board.members.filter(m => m.user !== username);
    await board.save();

    await logAction(boardId, req.user.username, `Removed ${username}`);
    req.wsManager.sendToUser(username, { type: 'KICKED', boardId });
    req.wsManager.broadcastToBoard(boardId, { 
        type: 'MEMBER_REMOVED', 
        username 
    });
    
    req.wsManager.broadcastAll({ type: 'BOARDS_UPDATED' });
    
    res.json({ success: true });
};

exports.getBoardData = async (req, res) => {
    const { boardId } = req.query;
    const role = await getBoardAccess(boardId, req.user.username);
    if (!role) throw new AppError('Access Denied', 403);

    const [columns, tasks, history, board] = await Promise.all([
        Column.find({ boardId }).sort({ order: 1 }).lean(),
        Task.find({ boardId }).sort({ order: 1 }).lean(),
        History.find({ boardId }).sort({ date: -1 }).limit(50).lean(),
        Board.findById(boardId).lean()
    ]);

    const members = [{ user: board.owner, role: 'owner' }, ...board.members];
    const allUsernames = new Set();

    members.forEach(m => allUsernames.add(m.user));
    tasks.forEach(t => {
        allUsernames.add(t.author);
        t.comments.forEach(c => allUsernames.add(c.author));
    });
    history.forEach(h => allUsernames.add(h.user));

    const usersData = await User.find({ username: { $in: Array.from(allUsernames) } })
        .select('username displayName avatar').lean();

    const usersMap = {};
    usersData.forEach(u => usersMap[u.username] = u);

    res.json({ columns, tasks, history, board, members, myRole: role, users: usersMap });
};