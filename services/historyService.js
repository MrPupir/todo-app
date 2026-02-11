const { History } = require('../models');

async function logAction(boardId, user, text) {
    await History.create({ boardId, user, text });
}

module.exports = {
    logAction
};
