const AppError = require('../utils/AppError');
const { Column, Task } = require('../models');
const { deleteTaskAttachments } = require('../utils/fileUtils');
const { logAction } = require('../services/historyService');
const { checkAccess } = require('../middleware/boardAccess');

exports.createColumn = async (req, res) => {
    const { title, boardId } = req.body;
    await checkAccess(boardId, req.user.username, ['edit', 'owner']);

    const count = await Column.countDocuments({ boardId });
    await Column.create({ title, boardId, order: count });

    await logAction(boardId, req.user.username, `Added column "${title}"`);
    req.wsManager.broadcastToBoard(boardId, { type: 'UPDATE' });
    res.json({ success: true });
};

exports.deleteColumn = async (req, res) => {
    const { columnId, boardId } = req.body;
    await checkAccess(boardId, req.user.username, ['edit', 'owner']);

    const col = await Column.findById(columnId);
    if (!col) return res.json({ success: true });

    const tasks = await Task.find({ columnId });
    await Promise.all(tasks.map(t => deleteTaskAttachments(t)));

    await Task.deleteMany({ columnId });
    await Column.findByIdAndDelete(columnId);

    await logAction(boardId, req.user.username, `Deleted column "${col.title}"`);
    req.wsManager.broadcastToBoard(boardId, { type: 'UPDATE' });
    res.json({ success: true });
};

exports.reorderColumn = async (req, res) => {
    const { columnId, newIndex, boardId } = req.body;
    await checkAccess(boardId, req.user.username, ['edit', 'owner']);

    const col = await Column.findById(columnId);
    if (!col) throw new AppError('Column not found', 404);

    const oldIndex = col.order;
    if (oldIndex !== newIndex) {
        if (newIndex > oldIndex) {
            await Column.updateMany({ boardId, order: { $gt: oldIndex, $lte: newIndex } }, { $inc: { order: -1 } });
        } else {
            await Column.updateMany({ boardId, order: { $gte: newIndex, $lt: oldIndex } }, { $inc: { order: 1 } });
        }
        col.order = newIndex;
        await col.save();
        req.wsManager.broadcastToBoard(boardId, { type: 'UPDATE' });
    }
    res.json({ success: true });
};
