const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    columnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Column', index: true },
    content: { type: String, required: true },
    priority: { type: String, default: 'Normal' },
    color: { type: String, default: '#27272a' },
    order: { type: Number, default: 0 },
    comments: [{
        _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
        text: String,
        author: String,
        replyTo: { type: mongoose.Schema.Types.Mixed, default: null },
        created: { type: Date, default: Date.now },
        editedAt: Date,
        attachments: [{ type: { type: String }, url: String, originalName: String }]
    }],
    created: { type: Date, default: Date.now },
    author: String
});

module.exports = mongoose.model('Task', TaskSchema);
