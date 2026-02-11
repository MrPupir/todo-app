const fs = require('fs');
const path = require('path');
const AppError = require('../utils/AppError');
const { Task } = require('../models');
const CONFIG = require('../config/config');

exports.downloadFile = async (req, res, next) => {
    const filename = req.params.filename;
    const filePath = path.join(CONFIG.UPLOAD_DIR, filename);

    if (filename.includes('..') || filename.includes('/')) return next(new AppError('Invalid filename', 400));
    if (!fs.existsSync(filePath)) return next(new AppError('File not found', 404));

    const fileUrl = '/uploads/' + filename;
    const task = await Task.findOne({ 'comments.attachments.url': fileUrl }, { 'comments.$': 1 }).lean();

    let originalName = filename;
    if (task && task.comments && task.comments[0]) {
        const att = task.comments[0].attachments.find(a => a.url === fileUrl);
        if (att) originalName = att.originalName;
    }

    res.download(filePath, originalName);
};
