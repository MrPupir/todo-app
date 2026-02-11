const fs = require('fs').promises;
const path = require('path');
const CONFIG = require('../config/config');
const { User, Task } = require('../models');

async function cleanupUnusedFiles() {
    try {
        console.log('Starting cleanup of unused files...');
        
        const files = await fs.readdir(CONFIG.UPLOAD_DIR);
        
        const usedFiles = new Set();
        
        const users = await User.find({ avatar: { $exists: true, $ne: null } }).select('avatar').lean();
        users.forEach(user => {
            if (user.avatar) {
                const filename = path.basename(user.avatar);
                usedFiles.add(filename);
            }
        });
        
        const tasks = await Task.find({ 'comments.attachments.url': { $exists: true } })
            .select('comments.attachments.url').lean();
        tasks.forEach(task => {
            if (task.comments) {
                task.comments.forEach(comment => {
                    if (comment.attachments) {
                        comment.attachments.forEach(att => {
                            if (att.url) {
                                const filename = path.basename(att.url);
                                usedFiles.add(filename);
                            }
                        });
                    }
                });
            }
        });
        
        let deletedCount = 0;
        let errorCount = 0;
        
        for (const file of files) {
            if (!usedFiles.has(file)) {
                try {
                    const filePath = path.join(CONFIG.UPLOAD_DIR, file);
                    await fs.unlink(filePath);
                    deletedCount++;
                } catch (error) {
                    console.error(`Error deleting file ${file}:`, error.message);
                    errorCount++;
                }
            }
        }
        
        console.log(`Cleanup completed: ${deletedCount} files deleted, ${errorCount} errors`);
        return { deletedCount, errorCount };
    } catch (error) {
        console.error('Error during cleanup:', error);
        throw error;
    }
}

function startCleanupScheduler() {
    cleanupUnusedFiles();
    
    setInterval(() => {
        cleanupUnusedFiles();
    }, CONFIG.CLEANUP_INTERVAL);
    
    console.log(`Cleanup scheduler started. Interval: ${CONFIG.CLEANUP_INTERVAL / 1000 / 60} minutes`);
}

module.exports = {
    cleanupUnusedFiles,
    startCleanupScheduler
};
