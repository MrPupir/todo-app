const { deleteFile } = require('../utils/fileUtils');
const AppError = require('../utils/AppError');

exports.updateAvatar = async (req, res) => {
    if (!req.file) throw new AppError('No file uploaded', 400);
    if (req.user.avatar) await deleteFile(req.user.avatar);

    req.user.avatar = '/uploads/' + req.file.filename;
    await req.user.save();

    req.wsManager.updateUserSocket(req.user.username, { avatar: req.user.avatar });
    req.wsManager.broadcastAll({
        type: 'USER_UPDATED',
        username: req.user.username,
        avatar: req.user.avatar,
        displayName: req.user.displayName
    });

    res.json({ success: true, avatar: req.user.avatar });
};

exports.deleteAvatar = async (req, res) => {
    if (req.user.avatar) await deleteFile(req.user.avatar);
    req.user.avatar = null;
    await req.user.save();

    req.wsManager.updateUserSocket(req.user.username, { avatar: null });
    req.wsManager.broadcastAll({
        type: 'USER_UPDATED',
        username: req.user.username,
        avatar: null,
        displayName: req.user.displayName
    });

    res.json({ success: true });
};

exports.updateProfile = async (req, res) => {
    const { displayName } = req.body;
    if (!displayName) throw new AppError('Display name required', 400);

    req.user.displayName = displayName;
    await req.user.save();

    req.wsManager.updateUserSocket(req.user.username, { displayName });
    req.wsManager.broadcastAll({
        type: 'USER_UPDATED',
        username: req.user.username,
        avatar: req.user.avatar,
        displayName
    });

    res.json({ success: true });
};