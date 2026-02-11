const express = require('express');
const multer = require('multer');
const path = require('path');
const CONFIG = require('../config/config');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const authenticate = require('../middleware/auth');
const taskController = require('../controllers/taskController');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CONFIG.UPLOAD_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|webm|pdf|doc|docx|txt/;
    const ext = path.extname(file.originalname).toLowerCase().substring(1);
    if (allowed.test(ext)) cb(null, true);
    else cb(new AppError('File type not allowed', 400), false);
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: CONFIG.MAX_FILE_SIZE }
});

const injectWsManager = (wsManager) => (req, res, next) => {
    req.wsManager = wsManager;
    next();
};

const createRoutes = (wsManager) => {
    const router = express.Router();
    router.post('/create', authenticate, injectWsManager(wsManager), catchAsync(taskController.createTask));
    router.put('/update', authenticate, injectWsManager(wsManager), catchAsync(taskController.updateTask));
    router.put('/reorder', authenticate, injectWsManager(wsManager), catchAsync(taskController.reorderTask));
    router.delete('/delete', authenticate, injectWsManager(wsManager), catchAsync(taskController.deleteTask));
    router.post('/comment', authenticate, upload.array('files'), injectWsManager(wsManager), catchAsync(taskController.addComment));
    router.put('/comments/edit', authenticate, injectWsManager(wsManager), catchAsync(taskController.editComment));
    router.delete('/comments/delete', authenticate, injectWsManager(wsManager), catchAsync(taskController.deleteComment));
    return router;
};

module.exports = createRoutes;
