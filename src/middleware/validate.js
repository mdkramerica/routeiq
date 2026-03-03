/**
 * Input validation middleware using Joi
 */
const Joi = require('joi');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const messages = error.details.map((d) => d.message).join('; ');
      return res.status(400).json({ error: messages });
    }

    req[source] = value;
    next();
  };
}

// ─── Auth Schemas ────────────────────────────────────────────────────────────

const registerSchema = Joi.object({
  email: Joi.string().email().required().max(255),
  password: Joi.string().min(8).max(128).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required().max(255),
  password: Joi.string().required().max(128),
});

const magicLinkSchema = Joi.object({
  email: Joi.string().email().required().max(255),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().max(255),
});

const resetPasswordSchema = Joi.object({
  access_token: Joi.string().required(),
  password: Joi.string().min(8).max(128).required(),
});

// ─── Account Schemas ─────────────────────────────────────────────────────────

const createAccountSchema = Joi.object({
  name: Joi.string().required().min(1).max(255),
  address: Joi.string().allow('', null).max(500),
  contact_name: Joi.string().allow('', null).max(255),
  contact_email: Joi.string().email().allow('', null).max(255),
  contact_phone: Joi.string().allow('', null).max(50),
  notes: Joi.string().allow('', null).max(2000),
  priority: Joi.number().integer().valid(1, 2, 3).default(2),
  visit_frequency_days: Joi.number().integer().min(1).max(365).default(30),
});

const updateAccountSchema = Joi.object({
  name: Joi.string().min(1).max(255),
  address: Joi.string().allow('', null).max(500),
  contact_name: Joi.string().allow('', null).max(255),
  contact_email: Joi.string().email().allow('', null).max(255),
  contact_phone: Joi.string().allow('', null).max(50),
  notes: Joi.string().allow('', null).max(2000),
  priority: Joi.number().integer().valid(1, 2, 3),
  visit_frequency_days: Joi.number().integer().min(1).max(365),
}).min(1);

// ─── Route Schemas ───────────────────────────────────────────────────────────

const optimizeRouteSchema = Joi.object({
  accountIds: Joi.array().items(Joi.string().uuid()).min(1).max(50).required(),
  startLat: Joi.number().min(-90).max(90).default(0),
  startLng: Joi.number().min(-180).max(180).default(0),
  plan_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const savePlanSchema = Joi.object({
  plan_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  account_ids: Joi.array().items(Joi.string().uuid()).min(1).max(50).required(),
});

// ─── Brief/Voice Schemas ─────────────────────────────────────────────────────

const generateBriefSchema = Joi.object({
  accountId: Joi.string().uuid().required(),
});

const voiceLogBodySchema = Joi.object({
  accountId: Joi.string().uuid().required(),
});

// ─── Stripe Schemas ──────────────────────────────────────────────────────────

const checkoutSchema = Joi.object({
  plan: Joi.string().valid('solo', 'team', 'agency').required(),
});

module.exports = {
  validate,
  registerSchema,
  loginSchema,
  magicLinkSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  createAccountSchema,
  updateAccountSchema,
  optimizeRouteSchema,
  savePlanSchema,
  generateBriefSchema,
  voiceLogBodySchema,
  checkoutSchema,
};
