const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    displayName: { type: String, trim: true },
    avatar: { type: String },
    hash: { type: String, select: false }
});

UserSchema.methods.setPassword = async function (password) {
    this.hash = await bcrypt.hash(password, 12);
};

UserSchema.methods.validPassword = async function (password) {
    return await bcrypt.compare(password, this.hash);
};

module.exports = mongoose.model('User', UserSchema);
