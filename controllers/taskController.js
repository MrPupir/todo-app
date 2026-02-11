const path = require('path');
const AppError = require('../utils/AppError');
const { Task } = require('../models');
const { deleteTaskAttachments, deleteFile } = require('../utils/fileUtils');
const { logAction } = require('../services/historyService');
const { checkAccess, getBoardAccess } = require('../middleware/boardAccess');

exports.createTask = async (req, res) => {
    const { content, columnId, priority, color, boardId } = req.body;
    await checkAccess(boardId, req.user.username, ['edit', 'owner']);

    const count = await Task.countDocuments({ columnId });
    await Task.create({
        content, columnId, priority, color, boardId,
        author: req.user.username, order: count
    });

    await logAction(boardId, req.user.username, `Created task`);
    req.wsManager.broadcastToBoard(boardId, { type: 'UPDATE' });
    res.json({ success: true });
};

exports.updateTask = async (req, res) => {
    const { taskId, priority, color, content } = req.body;
    const task = await Task.findById(taskId);
    if (!task) throw new AppError('Task not found', 404);

    await checkAccess(task.boardId, req.user.username, ['edit', 'owner']);

    task.priority = priority;
    task.color = color;
    task.content = content;
    await task.save();

    req.wsManager.broadcastToBoard(task.boardId, { type: 'UPDATE' });
    res.json({ success: true });
};

exports.reorderTask = async (req, res) => {
    const { taskId, targetColumnId, newIndex } = req.body;
    const task = await Task.findById(taskId);
    if (!task) throw new AppError('Task not found', 404);

    await checkAccess(task.boardId, req.user.username, ['edit', 'owner']);

    const sourceCol = task.columnId.toString();
    const oldIndex = task.order;

    if (sourceCol === targetColumnId) {
        if (oldIndex !== newIndex) {
            const shift = newIndex > oldIndex ? -1 : 1;
            const range = newIndex > oldIndex
                ? { $gt: oldIndex, $lte: newIndex }
                : { $gte: newIndex, $lt: oldIndex };

            await Task.updateMany({ columnId: sourceCol, order: range }, { $inc: { order: shift } });
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
    req.wsManager.broadcastToBoard(task.boardId, { type: 'UPDATE' });
    res.json({ success: true });
};

exports.deleteTask = async (req, res) => {
    const { taskId } = req.body;
    const task = await Task.findById(taskId);
    if (!task) return res.json({ success: true });

    await checkAccess(task.boardId, req.user.username, ['edit', 'owner']);

    const boardId = task.boardId;
    await deleteTaskAttachments(task);
    await Task.updateMany({ columnId: task.columnId, order: { $gt: task.order } }, { $inc: { order: -1 } });
    await Task.findByIdAndDelete(taskId);

    await logAction(boardId, req.user.username, `Deleted task`);
    req.wsManager.broadcastToBoard(boardId, { type: 'UPDATE', deletedTaskId: taskId });
    res.json({ success: true });
};

exports.addComment = async (req, res) => {
    const { taskId, text, replyTo } = req.body;
    const task = await Task.findById(taskId);
    if (!task) throw new AppError('Task not found', 404);

    const role = await getBoardAccess(task.boardId, req.user.username);
    if (!role || role === 'view') throw new AppError('Forbidden', 403);

    if (!text && (!req.files || req.files.length === 0)) {
        throw new AppError('Message cannot be empty', 400);
    }

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
    req.wsManager.broadcastToBoard(task.boardId, { type: 'UPDATE' });
    res.json({ success: true });
};

exports.editComment = async (req, res) => {
    const { taskId, commentId, text } = req.body;
    if (!text || !text.trim()) throw new AppError('Message cannot be empty', 400);

    const task = await Task.findById(taskId);
    if (!task) throw new AppError('Task not found', 404);

    const comment = task.comments.id(commentId);
    if (!comment) throw new AppError('Comment not found', 404);
    if (comment.author !== req.user.username) throw new AppError('Forbidden', 403);

    comment.text = text;
    comment.editedAt = new Date();
    await task.save();

    req.wsManager.broadcastToBoard(task.boardId, { type: 'UPDATE' });
    res.json({ success: true });
};

exports.deleteComment = async (req, res) => {
    const { taskId, commentId } = req.body;
    const task = await Task.findById(taskId);
    if (!task) throw new AppError('Task not found', 404);

    const comment = task.comments.id(commentId);
    if (!comment) throw new AppError('Comment not found', 404);

    if (comment.author !== req.user.username) throw new AppError('Forbidden', 403);

    if (comment.attachments?.length > 0) {
        await Promise.all(comment.attachments.map(att => deleteFile(att.url)));
    }

    task.comments.pull(commentId);
    await task.save();

    req.wsManager.broadcastToBoard(task.boardId, { type: 'UPDATE' });
    res.json({ success: true });
};
