const AppError = require('../utils/AppError');
const { Board } = require('../models');

async function getBoardAccess(boardId, username) {
    if (!boardId) return null;
    const board = await Board.findById(boardId).lean();
    if (!board) return null;
    if (board.owner === username) return 'owner';
    const member = board.members.find(m => m.user === username);
    return member ? member.role : null;
}

async function checkAccess(boardId, username, requiredRoles) {
    const role = await getBoardAccess(boardId, username);
    if (!role || !requiredRoles.includes(role)) {
        throw new AppError('Forbidden', 403);
    }
    return role;
}

module.exports = {
    getBoardAccess,
    checkAccess
};
