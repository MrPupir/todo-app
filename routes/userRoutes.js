const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const CONFIG = require('../config/config');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const authenticate = require('../middleware/auth');
const userController = require('../controllers/userController');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CONFIG.UPLOAD_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = path.extname(file.originalname).toLowerCase().substring(1);
    if (allowed.test(ext)) cb(null, true);
    else cb(new AppError('File type not allowed', 400), false);
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: CONFIG.MAX_FILE_SIZE }
});

router.put('/avatar', authenticate, upload.single('avatar'), catchAsync(userController.updateAvatar));
router.delete('/avatar', authenticate, catchAsync(userController.deleteAvatar));
router.put('/profile', authenticate, catchAsync(userController.updateProfile));

module.exports = router;
