const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');
const { User } = require('../models');
const CONFIG = require('../config/config');

exports.register = async (req, res) => {
    const { username, password, displayName } = req.body;

    const existing = await User.exists({ username });
    if (existing) throw new AppError('Username taken', 400);

    const user = new User({ username, displayName: displayName || username });
    if (req.file) user.avatar = '/uploads/' + req.file.filename;

    await user.setPassword(password);
    await user.save();

    const token = jwt.sign({ id: user._id, username: user.username }, CONFIG.JWT_SECRET, { expiresIn: CONFIG.JWT_EXPIRES });
    res.status(201).json({ success: true, token, user: { username: user.username, displayName: user.displayName, avatar: user.avatar } });
};

exports.login = async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username }).select('+hash');

    if (!user || !(await user.validPassword(password))) {
        throw new AppError('Invalid credentials', 401);
    }

    const token = jwt.sign({ id: user._id, username: user.username }, CONFIG.JWT_SECRET, { expiresIn: CONFIG.JWT_EXPIRES });
    res.json({ success: true, token, user: { username: user.username, displayName: user.displayName, avatar: user.avatar } });
};

exports.check = async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ success: false });
    try {
        const decoded = jwt.verify(token, CONFIG.JWT_SECRET);
        const user = await User.findById(decoded.id).lean();
        if (!user) return res.json({ success: false });
        res.json({ success: true, username: user.username, displayName: user.displayName || user.username, avatar: user.avatar });
    } catch {
        res.json({ success: false });
    }
};
