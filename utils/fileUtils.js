const fs = require('fs').promises;
const path = require('path');
const CONFIG = require('../config/config');

async function deleteFile(fileUrl) {
    if (!fileUrl) return;
    const filename = path.basename(fileUrl);
    const fullPath = path.join(CONFIG.UPLOAD_DIR, filename);
    try {
        await fs.unlink(fullPath);
    } catch {}
}

async function deleteTaskAttachments(task) {
    if (!task.comments) return;
    const deletionPromises = [];
    task.comments.forEach(comment => {
        if (comment.attachments?.length > 0) {
            comment.attachments.forEach(att => deletionPromises.push(deleteFile(att.url)));
        }
    });
    await Promise.all(deletionPromises);
}

module.exports = {
    deleteFile,
    deleteTaskAttachments
};
