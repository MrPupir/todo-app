const joi = require('joi');
const AppError = require('../utils/AppError');

const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
        const msg = error.details.map(el => el.message).join(',');
        return next(new AppError(msg, 400));
    }
    next();
};

const registerSchema = joi.object({
    username: joi.string().alphanum().min(3).required(),
    password: joi.string().min(6).required(),
    displayName: joi.string().optional().allow('')
});

module.exports = {
    validate,
    registerSchema
};
