const express = require('express');
const catchAsync = require('../utils/catchAsync');
const authenticate = require('../middleware/auth');
const columnController = require('../controllers/columnController');

const injectWsManager = (wsManager) => (req, res, next) => {
    req.wsManager = wsManager;
    next();
};

const createRoutes = (wsManager) => {
    const router = express.Router();
    router.post('/create', authenticate, injectWsManager(wsManager), catchAsync(columnController.createColumn));
    router.delete('/delete', authenticate, injectWsManager(wsManager), catchAsync(columnController.deleteColumn));
    router.put('/reorder', authenticate, injectWsManager(wsManager), catchAsync(columnController.reorderColumn));
    return router;
};

module.exports = createRoutes;
