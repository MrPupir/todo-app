const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');
const { User } = require('../models');
const CONFIG = require('../config/config');

async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new AppError('Unauthorized', 401));
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, CONFIG.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) return next(new AppError('User no longer exists', 401));
        req.user = user;
        next();
    } catch {
        return next(new AppError('Invalid token', 401));
    }
}

module.exports = authenticate;
